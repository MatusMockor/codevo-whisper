import { mkdir, rm, stat } from 'node:fs/promises';
import type { ActiveModel, ModelVerification } from '../engines/active-model';
import { consoleLogger, type Logger } from '../logging/logger';
import type { SettingsStore } from '../settings/settings-store';
import type { LanguageHint, ModelState } from '../../shared/models';
import type { CatalogEntry } from './catalog-entry';
import { downloadFile } from './downloader';
import { hashFile } from './file-hash';
import { huggingFaceUrl } from './model-catalog';
import { ModelError } from './model-error';
import { modelFiles, scanModelState, type ModelFiles } from './model-files';
import { ModelStateBoard, type ModelStatesListener } from './model-state-board';
import { VerificationCache } from './verification-cache';
import type { WarmUp } from './warm-up';

export type ModelManagerDeps = {
  dir: string;
  catalog: readonly CatalogEntry[];
  settings: Pick<SettingsStore, 'get' | 'update'>;
  fetchImpl?: typeof fetch;
  warmUp: WarmUp;
  logger?: Logger;
};

type RunningDownload = { id: string; controller: AbortController; done: Promise<void> };

const CONTENT_FAILURES: ReadonlySet<string> = new Set(['checksum', 'size']);

function isContentFailure(error: unknown): boolean {
  return error instanceof ModelError && CONTENT_FAILURES.has(error.reason);
}

export class ModelManager implements ActiveModel {
  private readonly verified = new VerificationCache();
  private readonly logger: Logger;
  private readonly board: ModelStateBoard;
  private running: RunningDownload | null = null;

  constructor(private readonly deps: ModelManagerDeps) {
    this.logger = deps.logger ?? consoleLogger;
    this.board = new ModelStateBoard(
      deps.catalog.map((entry) => scanModelState(entry, this.files(entry))),
      this.logger,
    );
  }

  states(): ModelState[] {
    return this.board.snapshot();
  }

  async download(id: string): Promise<void> {
    const entry = this.entry(id);
    if (this.running !== null && this.running.id !== id) {
      throw new ModelError('busy', `Another model is downloading: ${this.running.id}`);
    }
    if (this.running !== null) {
      return this.running.done;
    }
    if (this.board.get(id)?.status === 'ready') {
      return;
    }
    const controller = new AbortController();
    const done = this.runDownload(entry, controller.signal).finally(() => {
      this.running = null;
    });
    this.running = { id, controller, done };
    return done;
  }

  pause(id: string): void {
    this.entry(id);
    if (this.running?.id !== id) {
      return;
    }
    this.running.controller.abort();
  }

  async delete(id: string): Promise<void> {
    const entry = this.entry(id);
    await this.stopDownload(id);
    const files = this.files(entry);
    await rm(files.model, { force: true });
    await rm(files.partial, { force: true });
    this.verified.forget(id);
    this.board.set(entry.id, { status: 'not-downloaded', receivedBytes: 0 });
    if (this.deps.settings.get().localModelId === id) {
      await this.deps.settings.update({ localModelId: null });
    }
  }

  async activate(id: string): Promise<void> {
    const entry = this.entry(id);
    if ((await this.verify(id)) !== 'ok') {
      throw new ModelError('not-ready', `Model ${id} is not downloaded or is broken`);
    }
    await this.deps.settings.update({ localModelId: id });
    try {
      await this.deps.warmUp(this.files(entry).model);
    } catch (error) {
      this.logger.error(`Warm-up of model ${id} failed`, error);
    }
  }

  async verify(id: string): Promise<ModelVerification> {
    const entry = this.entry(id);
    const result = await this.check(entry);
    this.applyVerification(entry, result);
    return result;
  }

  activeModelPath(): Promise<string | null> {
    const entry = this.activeEntry();
    return Promise.resolve(entry === null ? null : this.files(entry).model);
  }

  async verifyActive(): Promise<ModelVerification> {
    const entry = this.activeEntry();
    if (entry === null) {
      return 'missing';
    }
    return this.verify(entry.id);
  }

  activeLanguageHint(): LanguageHint | null {
    return this.activeEntry()?.languageHint ?? null;
  }

  onChange(listener: ModelStatesListener): () => void {
    return this.board.onChange(listener);
  }

  private async runDownload(entry: CatalogEntry, signal: AbortSignal): Promise<void> {
    const files = this.files(entry);
    await mkdir(this.deps.dir, { recursive: true });
    await rm(files.model, { force: true });
    this.verified.forget(entry.id);
    this.board.set(entry.id, { status: 'downloading' });
    try {
      await downloadFile({
        url: huggingFaceUrl(entry.source),
        files,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
        fetchImpl: this.deps.fetchImpl ?? fetch,
        signal,
        onProgress: (receivedBytes) => this.board.progress(entry.id, receivedBytes),
      });
    } catch (error) {
      this.settleFailure(entry, files, error, signal);
      return;
    }
    this.verified.remember(entry.id, await stat(files.model, { bigint: true }), 'ok');
    this.board.set(entry.id, { status: 'ready', receivedBytes: entry.sizeBytes });
  }

  private settleFailure(entry: CatalogEntry, files: ModelFiles, error: unknown, signal: AbortSignal): void {
    if (isContentFailure(error)) {
      this.board.set(entry.id, { status: 'broken', receivedBytes: 0 });
      throw error;
    }
    this.board.set(entry.id, scanModelState(entry, files));
    if (signal.aborted) {
      return;
    }
    throw error;
  }

  private async stopDownload(id: string): Promise<void> {
    if (this.running?.id !== id) {
      return;
    }
    const { controller, done } = this.running;
    controller.abort();
    await done.catch(() => undefined);
  }

  private async check(entry: CatalogEntry): Promise<ModelVerification> {
    const file = this.files(entry).model;
    const info = await stat(file, { bigint: true }).catch(() => null);
    if (info === null) {
      return 'missing';
    }
    if (info.size !== BigInt(entry.sizeBytes)) {
      return 'broken';
    }
    const cached = this.verified.lookup(entry.id, info);
    if (cached !== null) {
      return cached;
    }
    const digest = (await hashFile(file)).digest('hex');
    const result = digest === entry.sha256 ? 'ok' : 'broken';
    this.verified.remember(entry.id, info, result);
    return result;
  }

  private applyVerification(entry: CatalogEntry, result: ModelVerification): void {
    if (this.running?.id === entry.id) {
      return;
    }
    if (result === 'missing') {
      this.board.set(entry.id, scanModelState(entry, this.files(entry)));
      return;
    }
    if (result === 'broken') {
      this.board.set(entry.id, { status: 'broken', receivedBytes: 0 });
      return;
    }
    this.board.set(entry.id, { status: 'ready', receivedBytes: entry.sizeBytes });
  }

  private activeEntry(): CatalogEntry | null {
    const id = this.deps.settings.get().localModelId;
    return this.deps.catalog.find((entry) => entry.id === id) ?? null;
  }

  private entry(id: string): CatalogEntry {
    const entry = this.deps.catalog.find((candidate) => candidate.id === id);
    if (entry === undefined) {
      throw new ModelError('unknown-model', `Unknown model ${id}`);
    }
    return entry;
  }

  private files(entry: CatalogEntry): ModelFiles {
    return modelFiles(this.deps.dir, entry);
  }
}
