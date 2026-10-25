import { CatalogError } from './catalog-error';
import { MODEL_BACKENDS, PLATFORM_KEYS, type CatalogDefault, type CatalogDefaults, type CatalogEntry, type PlatformKey } from './catalog-entry';
import { field, isText, oneOf, requireRecord } from './catalog-fields';
import { parseEntry } from './parse-entry';

const SCHEMA_VERSION = 1;

export type ParsedCatalog = { defaults: CatalogDefaults; models: readonly CatalogEntry[] };

function parseModels(raw: unknown): CatalogEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new CatalogError('catalog: models must be a non-empty array');
  }
  const models = raw.map((entry, index) => parseEntry(entry, index));
  const seen = new Set<string>();
  for (const model of models) {
    if (seen.has(model.id)) {
      throw new CatalogError(`catalog: duplicate model id ${model.id}`);
    }
    seen.add(model.id);
  }
  return models;
}

function parseDefault(raw: unknown, key: PlatformKey, ids: ReadonlySet<string>): CatalogDefault {
  const where = `defaults ${key}`;
  const record = requireRecord(raw, where);
  const model = field(record, 'model', (value): value is string => isText(value) && ids.has(value), where);
  return { model, backend: field(record, 'backend', oneOf(MODEL_BACKENDS), where) };
}

function parseDefaults(raw: unknown, models: readonly CatalogEntry[]): CatalogDefaults {
  const record = requireRecord(raw, 'catalog defaults');
  const ids = new Set(models.map((model) => model.id));
  return Object.freeze(Object.fromEntries(PLATFORM_KEYS.map((key) => [key, parseDefault(record[key], key, ids)])) as Record<PlatformKey, CatalogDefault>);
}

export function parseCatalog(raw: unknown): ParsedCatalog {
  const record = requireRecord(raw, 'catalog');
  if (record['schema'] !== SCHEMA_VERSION) {
    throw new CatalogError(`catalog: unsupported schema ${String(record['schema'])}`);
  }
  const models = parseModels(record['models']);
  return { defaults: parseDefaults(record['defaults'], models), models };
}
