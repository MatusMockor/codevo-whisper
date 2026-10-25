import { rm } from 'node:fs/promises';
import { localDate } from '../../shared/calendar-date';
import type { DayStats } from '../../shared/stats';
import { writeFileAtomic } from '../fs/atomic-write';
import { readOptionalFile } from '../fs/read-optional-file';
import { Listeners } from '../helper/listeners';
import { SerialQueue } from '../insertion/serial-queue';
import { consoleLogger, type Logger } from '../logging/logger';
import { parseStatsFile, serializeStatsFile } from './stats-file';

export type DictationEntry = { words: number; seconds: number };

export interface StatsRecorder {
  record(entry: DictationEntry): Promise<void>;
}

function roundSeconds(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

function copyDays(days: readonly DayStats[]): DayStats[] {
  return days.map((day) => ({ ...day }));
}

function added(days: readonly DayStats[], date: string, entry: DictationEntry): DayStats[] {
  const words = Math.max(0, Math.round(entry.words));
  const seconds = Number.isFinite(entry.seconds) ? Math.max(0, entry.seconds) : 0;
  const existing = days.find((day) => day.date === date) ?? { date, words: 0, dictations: 0, seconds: 0 };
  const updated = { date, words: existing.words + words, dictations: existing.dictations + 1, seconds: roundSeconds(existing.seconds + seconds) };
  return [...days.filter((day) => day.date !== date), updated].sort((a, b) => a.date.localeCompare(b.date));
}

export class StatsStore implements StatsRecorder {
  private memory: DayStats[] | null = null;
  private readonly queue = new SerialQueue();
  private readonly listeners: Listeners<DayStats[]>;

  constructor(
    private readonly file: string,
    private readonly clock: () => Date = () => new Date(),
    private readonly logger: Logger = consoleLogger,
  ) {
    this.listeners = new Listeners(logger, 'A statistics listener failed');
  }

  days(): Promise<DayStats[]> {
    return this.queue.run(async () => copyDays(await this.current()));
  }

  record(entry: DictationEntry): Promise<void> {
    return this.queue.run(async () => {
      const next = added(await this.current(), localDate(this.clock()), entry);
      await writeFileAtomic(this.file, serializeStatsFile(next));
      this.commit(next);
    });
  }

  reset(): Promise<void> {
    return this.queue.run(async () => {
      await rm(this.file, { force: true });
      this.commit([]);
    });
  }

  onChange(listener: (days: DayStats[]) => void): () => void {
    return this.listeners.add(listener);
  }

  private commit(days: DayStats[]): void {
    this.memory = days;
    this.listeners.emit(copyDays(days));
  }

  private async current(): Promise<DayStats[]> {
    if (this.memory !== null) {
      return this.memory;
    }
    this.memory = await this.load();
    return this.memory;
  }

  private async load(): Promise<DayStats[]> {
    const text = await readOptionalFile(this.file).catch((error: unknown) => {
      this.logger.error('The statistics file could not be read, starting empty', error);
      return null;
    });
    if (text === null) {
      return [];
    }
    const days = parseStatsFile(text);
    if (days === null) {
      this.logger.error('The statistics file is corrupt, starting empty', { file: this.file });
      return [];
    }
    return days;
  }
}
