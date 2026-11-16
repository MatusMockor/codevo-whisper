import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CatalogModel } from './catalog-models';
import type { DiskSpace } from './disk-space';
import type { ModelInventory } from './model-inventory';
import { downloadVerified } from './verified-download';

export const DOWNLOAD_SPACE_MARGIN_BYTES = 1024 * 1024 * 1024;

export type DownloadStart = 'started' | 'busy' | 'insufficient_space';

export type DownloadEvent = (event: string, fields: Record<string, string | number>) => void;

export type ModelDownloadsDeps = { inventory: ModelInventory; space: DiskSpace; fetchImpl?: typeof fetch; onEvent?: DownloadEvent };

type Startup = 'ready' | 'aborted' | 'insufficient_space';

type ActiveDownload = { id: string; controller: AbortController; received: number; done: Promise<void> };

export function partialPathOf(target: string): string {
  return `${target}.partial`;
}

export async function removePartials(models: readonly CatalogModel[]): Promise<void> {
  await Promise.all(models.map((model) => rm(partialPathOf(model.target), { force: true })));
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ModelDownloads {
  private active: ActiveDownload | null = null;
  private readonly failed = new Set<string>();

  constructor(private readonly deps: ModelDownloadsDeps) {}

  downloading(id: string): boolean {
    return this.active?.id === id;
  }

  receivedBytes(id: string): number | null {
    if (this.active?.id !== id) {
      return null;
    }
    return this.active.received;
  }

  hasFailed(id: string): boolean {
    return this.failed.has(id);
  }

  async start(model: CatalogModel): Promise<DownloadStart> {
    if (this.active !== null) {
      return this.active.id === model.id ? 'started' : 'busy';
    }
    const active: ActiveDownload = { id: model.id, controller: new AbortController(), received: 0, done: Promise.resolve() };
    this.active = active;
    const startup = this.startup(model, active.controller.signal);
    active.done = this.lifecycle(model, active, startup);
    return (await startup) === 'insufficient_space' ? 'insufficient_space' : 'started';
  }

  async cancel(id: string): Promise<boolean> {
    const active = this.active;
    if (active?.id !== id) {
      return false;
    }
    active.controller.abort();
    await active.done;
    return true;
  }

  async close(): Promise<void> {
    const active = this.active;
    active?.controller.abort();
    await active?.done;
  }

  private async hasRoomFor(model: CatalogModel): Promise<boolean> {
    const directory = dirname(model.target);
    await mkdir(directory, { recursive: true });
    return (await this.deps.space.availableBytes(directory)) >= model.size + DOWNLOAD_SPACE_MARGIN_BYTES;
  }

  private async startup(model: CatalogModel, signal: AbortSignal): Promise<Startup> {
    const room = await this.hasRoomFor(model);
    if (signal.aborted) {
      return 'aborted';
    }
    return room ? 'ready' : 'insufficient_space';
  }

  private async lifecycle(model: CatalogModel, active: ActiveDownload, startup: Promise<Startup>): Promise<void> {
    try {
      if ((await startup) !== 'ready') {
        return;
      }
      this.failed.delete(model.id);
      await this.run(model, active);
    } catch {
      return;
    } finally {
      this.release(active);
    }
  }

  private async run(model: CatalogModel, active: ActiveDownload): Promise<void> {
    const { signal } = active.controller;
    this.deps.onEvent?.('model_download_started', { model: model.id, bytes: model.size });
    try {
      await downloadVerified({
        url: model.url,
        sha256: model.sha256,
        size: model.size,
        target: model.target,
        temp: partialPathOf(model.target),
        signal,
        ...(this.deps.fetchImpl === undefined ? {} : { fetchImpl: this.deps.fetchImpl }),
        onProgress: (bytes) => {
          active.received = bytes;
        },
      });
      this.deps.inventory.markInstalled(model.id);
      this.deps.onEvent?.('model_downloaded', { model: model.id });
    } catch (error) {
      this.recordFailure(model, signal, error);
    }
  }

  private recordFailure(model: CatalogModel, signal: AbortSignal, error: unknown): void {
    if (signal.aborted) {
      this.deps.onEvent?.('model_download_cancelled', { model: model.id });
      return;
    }
    this.failed.add(model.id);
    this.deps.onEvent?.('model_download_failed', { model: model.id, reason: reasonOf(error) });
  }

  private release(active: ActiveDownload): void {
    if (this.active === active) {
      this.active = null;
    }
  }
}
