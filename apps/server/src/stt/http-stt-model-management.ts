import { isCatalogEntryList, type CatalogEntry, type ModelOperation, type ModelOperationOutcome } from '@codevo-whisper/protocol';
import { CAPABILITIES_TIMEOUT_MS, MAX_CAPABILITIES_RESPONSE_BYTES } from './http-stt-client';
import { readLimitedJson } from './read-limited-json';
import { NO_MODEL_CATALOG, type SttModelCatalog, type SttModelManagement } from './stt-model-management';

export const MODEL_OPERATION_TIMEOUT_MS = 30_000;
const MAX_OPERATION_RESPONSE_BYTES = 1024;

type Fields = Record<string, unknown>;

type Route = { method: 'POST' | 'DELETE'; path: (id: string) => string; outcomes: readonly ModelOperationOutcome[] };

const ROUTES: Readonly<Record<ModelOperation, Route>> = {
  download: { method: 'POST', path: (id) => `/models/${id}/download`, outcomes: ['started', 'installed'] },
  remove: { method: 'DELETE', path: (id) => `/models/${id}`, outcomes: ['removed', 'missing'] },
  cancel: { method: 'POST', path: (id) => `/models/${id}/cancel`, outcomes: ['cancelled', 'idle'] },
};

const REFUSALS: ReadonlyMap<string, ModelOperationOutcome> = new Map<string, ModelOperationOutcome>([
  ['unknown model', 'unknown_model'],
  ['downloads disabled', 'downloads_disabled'],
  ['download busy', 'download_busy'],
  ['insufficient space', 'insufficient_space'],
  ['model in use', 'model_in_use'],
  ['model not removable', 'model_not_removable'],
]);

function fieldsOf(value: unknown): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Fields;
}

function entryOf(value: unknown): Fields {
  const { id, name, family, sizeBytes, removable, state, receivedBytes } = fieldsOf(value);
  return { id, name, family, sizeBytes, removable, state, receivedBytes };
}

function entriesOf(value: unknown): readonly CatalogEntry[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries = value.map(entryOf);
  return isCatalogEntryList(entries) ? entries : null;
}

export function parseSttModelCatalog(body: unknown): SttModelCatalog {
  const { downloadsEnabled, models } = fieldsOf(body);
  const entries = entriesOf(models);
  if (typeof downloadsEnabled !== 'boolean' || entries === null) {
    return NO_MODEL_CATALOG;
  }
  return { downloadsEnabled, models: entries };
}

function outcomeOf(body: unknown, route: Route): ModelOperationOutcome {
  const { status, error } = fieldsOf(body);
  const success = route.outcomes.find((outcome) => outcome === status);
  if (success !== undefined) {
    return success;
  }
  return (typeof error === 'string' ? REFUSALS.get(error) : undefined) ?? 'stt_unavailable';
}

export class HttpSttModelManagement implements SttModelManagement {
  constructor(
    private readonly baseUrl: string,
    private readonly operationTimeoutMs = MODEL_OPERATION_TIMEOUT_MS,
  ) {}

  async catalog(): Promise<SttModelCatalog> {
    try {
      const response = await fetch(new URL('/catalog', this.baseUrl), { signal: AbortSignal.timeout(CAPABILITIES_TIMEOUT_MS) });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return NO_MODEL_CATALOG;
      }
      return parseSttModelCatalog(await readLimitedJson(response, MAX_CAPABILITIES_RESPONSE_BYTES));
    } catch {
      return NO_MODEL_CATALOG;
    }
  }

  async run(operation: ModelOperation, id: string): Promise<ModelOperationOutcome> {
    const route = ROUTES[operation];
    try {
      const response = await fetch(new URL(route.path(encodeURIComponent(id)), this.baseUrl), { method: route.method, signal: AbortSignal.timeout(this.operationTimeoutMs) });
      return outcomeOf(await readLimitedJson(response, MAX_OPERATION_RESPONSE_BYTES), route);
    } catch {
      return 'stt_unavailable';
    }
  }
}
