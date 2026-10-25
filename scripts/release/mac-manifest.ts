import { dump, load } from 'js-yaml';
import { FeedError } from './feed-error.ts';

export type FeedFile = { url: string; sha512: string; size: number; [extra: string]: unknown };

export type MacManifest = { version: string; files: FeedFile[]; path?: string; sha512?: string; releaseDate?: string };

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

export function parseMacManifest(text: string, source: string): MacManifest {
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

function uniqueByUrl(files: readonly FeedFile[]): FeedFile[] {
  const byUrl = new Map<string, FeedFile>();
  files.forEach((file) => byUrl.set(file.url, file));
  return [...byUrl.values()];
}

function latestReleaseDate(manifests: readonly MacManifest[]): Pick<MacManifest, 'releaseDate'> {
  const dates = manifests.flatMap((manifest) => (manifest.releaseDate === undefined ? [] : [manifest.releaseDate])).sort();
  const latest = dates.at(-1);
  return latest === undefined ? {} : { releaseDate: latest };
}

export function mergeMacManifests(manifests: readonly MacManifest[]): MacManifest {
  if (manifests.length < 2) {
    throw new FeedError('merge needs at least two manifests');
  }
  const versions = [...new Set(manifests.map((manifest) => manifest.version))];
  if (versions.length !== 1) {
    throw new FeedError(`version mismatch: ${versions.join(', ')}`);
  }
  const files = uniqueByUrl(manifests.flatMap((manifest) => manifest.files));
  const zips = files.filter((file) => file.url.endsWith('.zip'));
  const primary = zips.find((file) => !file.url.includes('arm64')) ?? zips[0];
  if (primary === undefined) {
    throw new FeedError('no zip entries, MacUpdater needs a zip');
  }
  return { version: versions[0] ?? '', files, path: primary.url, sha512: primary.sha512, ...latestReleaseDate(manifests) };
}

export function serializeMacManifest(manifest: MacManifest): string {
  return dump(manifest, { lineWidth: -1 });
}
