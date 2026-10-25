import type { SettingsStore } from '../settings/settings-store';
import { SerialQueue } from '../insertion/serial-queue';
import { ModelError } from './model-error';
import type { ModelManager } from './model-manager';

export type ModelActionsDeps = {
  models: Pick<ModelManager, 'download' | 'pause' | 'delete' | 'activate' | 'states'>;
  settings: Pick<SettingsStore, 'get'>;
};

export class ModelActions {
  private readonly queues = new Map<string, SerialQueue>();

  constructor(private readonly deps: ModelActionsDeps) {}

  download(id: string): Promise<void> {
    return this.known(id, () => this.queue(id).run(() => this.downloadAndActivate(id)));
  }

  pause(id: string): void {
    this.deps.models.pause(id);
  }

  delete(id: string): Promise<void> {
    return this.known(id, () => {
      this.deps.models.pause(id);
      return this.queue(id).run(() => this.deps.models.delete(id));
    });
  }

  queuedModels(): number {
    return this.queues.size;
  }

  activate(id: string): Promise<void> {
    return this.known(id, () => this.queue(id).run(() => this.deps.models.activate(id)));
  }

  private async downloadAndActivate(id: string): Promise<void> {
    await this.deps.models.download(id);
    await this.activateFirstReady(id);
  }

  private known(id: string, work: () => Promise<void>): Promise<void> {
    if (!this.deps.models.states().some((state) => state.id === id)) {
      return Promise.reject(new ModelError('unknown-model', `Unknown model ${id}`));
    }
    return work();
  }

  private async activateFirstReady(id: string): Promise<void> {
    if (this.deps.settings.get().localModelId !== null) {
      return;
    }
    if (!this.deps.models.states().some((state) => state.id === id && state.status === 'ready')) {
      return;
    }
    await this.deps.models.activate(id);
  }

  private queue(id: string): SerialQueue {
    const existing = this.queues.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const created = new SerialQueue();
    this.queues.set(id, created);
    return created;
  }
}
