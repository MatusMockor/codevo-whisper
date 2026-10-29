import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { HistoryPolicy, HistoryView } from '../../shared/history';
import { writeFileAtomic } from '../fs/atomic-write';
import { readOptionalFile } from '../fs/read-optional-file';
import { Listeners } from '../helper/listeners';
import { consoleLogger, type Logger } from '../logging/logger';
import { SerialQueue } from '../insertion/serial-queue';
import { parseHistoryFile, type HistoryFile } from './history-file';

export class HistoryStore {
  private memory: HistoryFile | null = null;
  private loaded = false;
  private writeError = false;
  private readonly queue = new SerialQueue();
  private pending = 0;
  private readonly listeners: Listeners<HistoryView>;

  constructor(private readonly file: string, logger: Logger = consoleLogger) {
    this.listeners = new Listeners(logger, 'A history listener failed');
  }

  view(): Promise<HistoryView> {
    return this.run(async () => {
      await this.load();
      return this.snapshot();
    });
  }

  configure(policy: HistoryPolicy): Promise<void> {
    return this.run(async () => {
      const current = await this.current();
      await this.commit({ ...current, policy: { ...policy }, entries: policy.enabled ? current.entries.slice(0, policy.limit) : [] });
    });
  }

  record(text: string): Promise<void> {
    return this.run(async () => {
      const current = await this.current();
      if (!current.policy.enabled || text.trim() === '') return;
      await this.commit({ ...current, entries: [{ id: randomUUID(), completedAt: Date.now(), text }, ...current.entries].slice(0, current.policy.limit) });
    });
  }

  deleteEntry(id: string): Promise<void> {
    return this.run(async () => {
      const current = await this.current();
      if (!current.entries.some((entry) => entry.id === id)) return;
      await this.commit({ ...current, entries: current.entries.filter((entry) => entry.id !== id) });
    });
  }

  clear(): Promise<void> {
    return this.run(async () => {
      const current = await this.current();
      await this.commit({ ...current, entries: [] });
    });
  }

  isBusy(): boolean { return this.pending > 0; }

  settled(): Promise<void> { return this.queue.run(async () => {}); }

  onChange(listener: (view: HistoryView) => void): () => void { return this.listeners.add(listener); }

  private run<T>(task: () => Promise<T>): Promise<T> {
    this.pending++;
    return this.queue.run(task).finally(() => { this.pending--; });
  }

  private async commit(next: HistoryFile): Promise<void> {
    try {
      await writeFileAtomic(this.file, `${JSON.stringify(next, null, 2)}\n`);
    } catch {
      this.writeError = true;
      try {
        await rm(`${this.file}.tmp`, { force: true });
      } catch {
        this.listeners.emit(this.snapshot());
        throw new Error('History could not be saved; temporary file cleanup failed');
      }
      this.listeners.emit(this.snapshot());
      throw new Error('History could not be saved');
    }
    this.memory = next;
    this.writeError = false;
    this.listeners.emit(this.snapshot());
  }

  private snapshot(): HistoryView {
    if (this.memory === null) return { kind: 'unavailable' };
    return { kind: 'ready', policy: { ...this.memory.policy }, entries: this.memory.entries.map((entry) => ({ ...entry })), writeError: this.writeError };
  }

  private async current(): Promise<HistoryFile> {
    await this.load();
    if (this.memory === null) throw new Error('History is unavailable');
    return this.memory;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      await rm(`${this.file}.tmp`, { force: true });
      const text = await readOptionalFile(this.file);
      this.memory = text === null ? { version: 1, policy: { enabled: false, limit: 100 }, entries: [] } : parseHistoryFile(text);
    } catch {
      this.memory = null;
    }
  }
}
