import type { CatalogEntry, ModelOperation, ModelOperationOutcome } from '@codevo-whisper/protocol';

export type SttModelCatalog = { downloadsEnabled: boolean; models: readonly CatalogEntry[] };

export const NO_MODEL_CATALOG: SttModelCatalog = Object.freeze({ downloadsEnabled: false, models: Object.freeze([]) });

export interface SttModelManagement {
  catalog(): Promise<SttModelCatalog>;
  run(operation: ModelOperation, id: string): Promise<ModelOperationOutcome>;
}
