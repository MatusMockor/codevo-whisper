import type { ModelCatalog, ModelOperation, ModelOperationOutcome } from '@codevo-whisper/protocol';
import type { RefreshableCapabilities } from '../stt/capability-cache';
import type { SttModelCatalog, SttModelManagement } from '../stt/stt-model-management';
import type { ModelPermissions } from './model-permissions';

export interface DeviceModelCatalog {
  catalog(deviceId: string): Promise<ModelCatalog>;
  run(deviceId: string, operation: ModelOperation, id: string): Promise<ModelOperationOutcome>;
}

export type ModelCatalogDeps = { stt: SttModelManagement; permissions: ModelPermissions; capabilities: RefreshableCapabilities };

export class ModelCatalogService implements DeviceModelCatalog {
  private pending: Promise<SttModelCatalog> | null = null;

  constructor(private readonly deps: ModelCatalogDeps) {}

  async catalog(deviceId: string): Promise<ModelCatalog> {
    const [canManage, catalog] = await Promise.all([this.deps.permissions.canManageModels(deviceId), this.sttCatalog(), this.deps.capabilities.refresh()]);
    return { canManage, downloadsEnabled: catalog.downloadsEnabled, models: catalog.models };
  }

  async run(deviceId: string, operation: ModelOperation, id: string): Promise<ModelOperationOutcome> {
    if (!(await this.deps.permissions.canManageModels(deviceId))) {
      return 'forbidden';
    }
    const outcome = await this.deps.stt.run(operation, id);
    await this.deps.capabilities.refresh();
    return outcome;
  }

  private sttCatalog(): Promise<SttModelCatalog> {
    this.pending ??= this.deps.stt.catalog().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}
