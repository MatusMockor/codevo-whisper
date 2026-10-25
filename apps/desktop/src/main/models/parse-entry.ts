import { CatalogError } from './catalog-error';
import { LANGUAGE_HINTS, MODEL_ENGINES, type CatalogEntry, type CatalogSource } from './catalog-entry';
import { field, isHttpsUrl, isPositiveInteger, isText, listOf, matching, oneOf, requireRecord } from './catalog-fields';

const MODEL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REPO = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;
const REVISION = /^[0-9a-f]{40}$/;
const FILE_NAME = /^[A-Za-z0-9][\w.-]*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const LANGUAGE_CODE = /^[a-z]{2,3}$/;

function parseSource(raw: unknown, where: string): CatalogSource {
  const record = requireRecord(raw, `${where} source`);
  return {
    repo: field(record, 'repo', matching(REPO), `${where} source`),
    revision: field(record, 'revision', matching(REVISION), `${where} source`),
    file: field(record, 'file', matching(FILE_NAME), `${where} source`),
  };
}

function requireMatchingLabels(roles: readonly string[], labels: readonly string[], where: string): void {
  if (roles.length !== labels.length) {
    throw new CatalogError(`${where}: roleLabels must match roles`);
  }
}

export function parseEntry(raw: unknown, index: number): CatalogEntry {
  const record = requireRecord(raw, `models[${index}]`);
  const id = field(record, 'id', matching(MODEL_ID), `models[${index}]`);
  const where = `model ${id}`;
  const roles = field(record, 'roles', listOf(isText), where);
  const roleLabels = field(record, 'roleLabels', listOf(isText), where);
  requireMatchingLabels(roles, roleLabels, where);
  return {
    id,
    name: field(record, 'name', isText, where),
    engine: field(record, 'engine', oneOf(MODEL_ENGINES), where),
    quantization: field(record, 'quantization', isText, where),
    languages: field(record, 'languages', listOf(matching(LANGUAGE_CODE)), where),
    languageHint: field(record, 'languageHint', oneOf(LANGUAGE_HINTS), where),
    sizeBytes: field(record, 'sizeBytes', isPositiveInteger, where),
    minRamBytes: field(record, 'minRamBytes', isPositiveInteger, where),
    license: field(record, 'license', isText, where),
    licenseUrl: field(record, 'licenseUrl', isHttpsUrl, where),
    attribution: field(record, 'attribution', isText, where),
    upstream: field(record, 'upstream', isHttpsUrl, where),
    source: parseSource(record['source'], where),
    sha256: field(record, 'sha256', matching(SHA256), where),
    roles,
    roleLabels,
  };
}
