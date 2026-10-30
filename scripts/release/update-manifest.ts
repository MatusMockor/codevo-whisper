import { dump, load } from 'js-yaml';
import { FeedError } from './feed-error.ts';

export type FeedFile = { url: string; sha512: string; size: number; [extra: string]: unknown };

export type UpdateManifest = { version: string; files: FeedFile[]; path?: string; sha512?: string; releaseDate?: string };

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFeedFile(value: unknown): value is FeedFile {
  if (!isFields(value)) {
    return false;
  }
  const { url, sha512, size } = value;
  return typeof url === 'string' && url !== '' && typeof sha512 === 'string' && sha512 !== '' && Number.isInteger(size);
}

function optionalString(fields: Fields, key: string): Partial<Record<string, string>> {
  const value = fields[key];
  if (typeof value === 'string') {
    return { [key]: value };
  }
  if (value instanceof Date) {
    return { [key]: value.toISOString() };
  }
  return {};
}

export function parseUpdateManifest(text: string, source: string): UpdateManifest {
  const document: unknown = load(text);
  if (!isFields(document) || typeof document['version'] !== 'string') {
    throw new FeedError(`${source}: not an update manifest`);
  }
  const files = document['files'];
  if (!Array.isArray(files) || files.length === 0) {
    throw new FeedError(`${source}: no files`);
  }
  const invalid = files.filter((file) => !isFeedFile(file));
  if (invalid.length > 0) {
    throw new FeedError(`${source}: invalid file entries ${JSON.stringify(invalid)}`);
  }
  return {
    version: document['version'],
    files: files as FeedFile[],
    ...optionalString(document, 'path'),
    ...optionalString(document, 'sha512'),
    ...optionalString(document, 'releaseDate'),
  };
}

export function serializeUpdateManifest(manifest: UpdateManifest): string {
  return dump(manifest, { lineWidth: -1 });
}
