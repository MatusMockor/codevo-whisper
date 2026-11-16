import type { CatalogEntry, ModelCatalog, ModelOperation, ModelOperationOutcome } from '@codevo-whisper/protocol';

export type { CatalogEntry, ModelCatalog, ModelOperation, ModelOperationOutcome };

export type ServerModelOutcome = ModelOperationOutcome | 'unreachable' | 'unsupported';
