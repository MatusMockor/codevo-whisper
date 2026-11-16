import type { CatalogModel, ModelFamily, PinnedCatalog } from './catalog-models';
import type { ModelDownloads } from './model-downloads';
import type { ModelInventory } from './model-inventory';
import type { ModelFileStore } from './model-file-store';
import type { TranscriptionModelCatalog } from './transcription-model-catalog';

export type CatalogState = 'installed' | 'missing' | 'downloading' | 'failed';

export type CatalogEntryReport = {
  id: string;
  name: string;
  family: ModelFamily;
  sizeBytes: number;
  removable: boolean;
  state: CatalogState;
  receivedBytes: number | null;
};

export type CatalogReport = { downloadsEnabled: boolean; models: CatalogEntryReport[] };

export type DownloadOutcome = 'started' | 'installed' | 'unknown_model' | 'downloads_disabled' | 'download_busy' | 'insufficient_space' | 'model_in_use';

export type RemoveOutcome = 'removed' | 'missing' | 'unknown_model' | 'downloads_disabled' | 'model_not_removable' | 'model_in_use' | 'download_busy';

export type CancelOutcome = 'cancelled' | 'idle' | 'unknown_model';

export type ModelManagementParts = {
  catalog: PinnedCatalog;
  models: TranscriptionModelCatalog;
  inventory: ModelInventory;
  downloads: ModelDownloads;
  files: ModelFileStore;
  downloadsEnabled: boolean;
};

export class ModelManagement {
  constructor(private readonly parts: ModelManagementParts) {}

  report(): CatalogReport {
    const { primary, alternatives } = this.parts.catalog;
    return {
      downloadsEnabled: this.parts.downloadsEnabled,
      models: [{ ...this.entryOf(primary), removable: false, state: 'installed', receivedBytes: null }, ...alternatives.map((model) => this.entryOf(model))],
    };
  }

  async download(id: string): Promise<DownloadOutcome> {
    if (id === this.parts.catalog.primary.id) {
      return 'installed';
    }
    const model = this.alternative(id);
    if (model === null) {
      return 'unknown_model';
    }
    if (!this.parts.downloadsEnabled) {
      return 'downloads_disabled';
    }
    if (this.parts.inventory.isInstalled(id)) {
      return 'installed';
    }
    if (this.parts.models.managed(id)?.removing() === true) {
      return 'model_in_use';
    }
    const start = await this.parts.downloads.start(model);
    if (start === 'busy') {
      return 'download_busy';
    }
    return start;
  }

  async remove(id: string): Promise<RemoveOutcome> {
    if (id === this.parts.catalog.primary.id) {
      return 'model_not_removable';
    }
    const model = this.alternative(id);
    const managed = this.parts.models.managed(id);
    if (model === null || managed === null) {
      return 'unknown_model';
    }
    if (!this.parts.downloadsEnabled) {
      return 'downloads_disabled';
    }
    if (this.parts.downloads.downloading(id)) {
      return 'download_busy';
    }
    if (!this.parts.inventory.isInstalled(id)) {
      return 'missing';
    }
    if (!managed.beginRemoval()) {
      return 'model_in_use';
    }
    try {
      this.parts.inventory.markMissing(id);
      await managed.unload();
      await this.deleteFile(model);
      return 'removed';
    } finally {
      managed.endRemoval();
    }
  }

  async cancel(id: string): Promise<CancelOutcome> {
    if (id !== this.parts.catalog.primary.id && this.alternative(id) === null) {
      return 'unknown_model';
    }
    return (await this.parts.downloads.cancel(id)) ? 'cancelled' : 'idle';
  }

  close(): Promise<void> {
    return this.parts.downloads.close();
  }

  private async deleteFile(model: CatalogModel): Promise<void> {
    try {
      await this.parts.files.remove(model.target);
    } catch (error) {
      if (await this.parts.files.exists(model.target)) {
        this.parts.inventory.markInstalled(model.id);
      }
      throw error;
    }
  }

  private alternative(id: string): CatalogModel | null {
    return this.parts.catalog.alternatives.find((model) => model.id === id) ?? null;
  }

  private entryOf(model: CatalogModel): CatalogEntryReport {
    const state = this.stateOf(model.id);
    const receivedBytes = state === 'downloading' ? this.parts.downloads.receivedBytes(model.id) : null;
    return { id: model.id, name: model.name, family: model.family, sizeBytes: model.size, removable: true, state, receivedBytes };
  }

  private stateOf(id: string): CatalogState {
    if (this.parts.inventory.isInstalled(id)) {
      return 'installed';
    }
    if (this.parts.downloads.downloading(id)) {
      return 'downloading';
    }
    if (this.parts.downloads.hasFailed(id)) {
      return 'failed';
    }
    return 'missing';
  }
}
