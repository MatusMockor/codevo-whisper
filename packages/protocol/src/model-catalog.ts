import { badMessage } from './errors';
import { assertOnlyKeys, readBoolean, readObject, type JsonObject } from './json-fields';
import { isModelName } from './server-models';
import { isTranscriptionModelId, MAX_TRANSCRIPTION_MODELS } from './transcription-models';

export const MODEL_FAMILIES = ['parakeet', 'whisper'] as const;

export type ModelFamily = (typeof MODEL_FAMILIES)[number];

export const CATALOG_STATES = ['installed', 'missing', 'downloading', 'failed'] as const;

export type CatalogState = (typeof CATALOG_STATES)[number];

export type CatalogEntry = {
  id: string;
  name: string;
  family: ModelFamily;
  sizeBytes: number;
  removable: boolean;
  state: CatalogState;
  receivedBytes: number | null;
};

export type ModelCatalog = { canManage: boolean; downloadsEnabled: boolean; models: readonly CatalogEntry[] };

export const MODEL_OPERATIONS = ['download', 'remove', 'cancel'] as const;

export type ModelOperation = (typeof MODEL_OPERATIONS)[number];

export const MODEL_OPERATION_OUTCOMES = [
  'started',
  'installed',
  'removed',
  'missing',
  'cancelled',
  'idle',
  'forbidden',
  'downloads_disabled',
  'download_busy',
  'insufficient_space',
  'model_in_use',
  'model_not_removable',
  'unknown_model',
  'stt_unavailable',
] as const;

export type ModelOperationOutcome = (typeof MODEL_OPERATION_OUTCOMES)[number];

const ENTRY_KEYS = ['id', 'name', 'family', 'sizeBytes', 'removable', 'state', 'receivedBytes'];
const CATALOG_KEYS = ['canManage', 'downloadsEnabled', 'models'];

function isChoice<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && (choices as readonly string[]).includes(value);
}

function isByteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hasReceivedBytesOfState(fields: JsonObject): boolean {
  if (fields.state === 'downloading') {
    return isByteCount(fields.receivedBytes);
  }
  return fields.receivedBytes === null;
}

function isEntry(value: unknown): value is CatalogEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as JsonObject;
  const exactKeys = Object.keys(fields).length === ENTRY_KEYS.length && ENTRY_KEYS.every((key) => key in fields);
  return (
    exactKeys &&
    isTranscriptionModelId(fields.id) &&
    isModelName(fields.name) &&
    isChoice(fields.family, MODEL_FAMILIES) &&
    isByteCount(fields.sizeBytes) &&
    typeof fields.removable === 'boolean' &&
    isChoice(fields.state, CATALOG_STATES) &&
    hasReceivedBytesOfState(fields)
  );
}

export function isCatalogEntryList(value: unknown): value is CatalogEntry[] {
  if (!Array.isArray(value) || value.length > MAX_TRANSCRIPTION_MODELS || !value.every(isEntry)) {
    return false;
  }
  const entries: readonly CatalogEntry[] = value;
  return new Set(entries.map((entry) => entry.id)).size === entries.length;
}

function copyEntry(entry: CatalogEntry): CatalogEntry {
  const { id, name, family, sizeBytes, removable, state, receivedBytes } = entry;
  return { id, name, family, sizeBytes, removable, state, receivedBytes };
}

export function readModelCatalog(object: JsonObject, key: string): ModelCatalog {
  const catalog = readObject(object, key);
  assertOnlyKeys(catalog, CATALOG_KEYS);
  if (!isCatalogEntryList(catalog.models)) {
    throw badMessage(`${key}.models is not a list of catalog models`);
  }
  return {
    canManage: readBoolean(catalog, 'canManage'),
    downloadsEnabled: readBoolean(catalog, 'downloadsEnabled'),
    models: catalog.models.map(copyEntry),
  };
}
