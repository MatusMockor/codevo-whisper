import type { BigIntStats } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CatalogEntry } from './catalog-entry';
import { hashFile } from './file-hash';

export type ExistingLocations = { hubCaches: readonly string[]; folders: readonly string[] };

export type ExistingFile = { path: string; info: BigIntStats };

const HANDY_APP_ID = 'com.pais.handy';

function defined(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

function under(base: string | null, ...parts: string[]): string | null {
  return base === null ? null : join(base, ...parts);
}

export function existingLocations(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform): ExistingLocations {
  const hubCaches = [
    defined(env.HF_HUB_CACHE),
    under(defined(env.HF_HOME), 'hub'),
    under(defined(env.XDG_CACHE_HOME), 'huggingface', 'hub'),
    join(home, '.cache', 'huggingface', 'hub'),
  ].filter((dir) => dir !== null);
  const appData = platform === 'darwin' ? join(home, 'Library', 'Application Support') : (defined(env.XDG_DATA_HOME) ?? join(home, '.local', 'share'));
  return { hubCaches: [...new Set(hubCaches)], folders: [join(appData, HANDY_APP_ID, 'models')] };
}

async function children(dir: string): Promise<string[]> {
  return (await readdir(dir).catch(() => [])).map((name) => join(dir, name));
}

async function hubCandidates(entry: CatalogEntry, cache: string): Promise<string[]> {
  const repo = join(cache, `models--${entry.source.repo.replaceAll('/', '--')}`);
  const snapshots = await children(join(repo, 'snapshots'));
  return [join(repo, 'blobs', entry.sha256), ...snapshots.map((snapshot) => join(snapshot, entry.source.file))];
}

async function candidates(entry: CatalogEntry, { hubCaches, folders }: ExistingLocations): Promise<string[]> {
  const found = await Promise.all([...hubCaches.map((cache) => hubCandidates(entry, cache)), ...folders.map(children)]);
  return found.flat();
}

async function regularFile(path: string): Promise<ExistingFile | null> {
  const real = await realpath(path).catch(() => null);
  if (real === null) {
    return null;
  }
  const info = await stat(real, { bigint: true }).catch(() => null);
  return info?.isFile() === true ? { path: real, info } : null;
}

function unchanged(before: BigIntStats, after: BigIntStats | null): boolean {
  return after !== null && after.size === before.size && after.mtimeNs === before.mtimeNs && after.ino === before.ino;
}

async function stableDigest(file: ExistingFile): Promise<string | null> {
  const digest = await hashFile(file.path).then(
    (hash) => hash.digest('hex'),
    () => null,
  );
  const after = await stat(file.path, { bigint: true }).catch(() => null);
  return unchanged(file.info, after) ? digest : null;
}

export async function findExisting(entry: CatalogEntry, locations: ExistingLocations): Promise<ExistingFile | null> {
  const seen = new Set<string>();
  for (const candidate of await candidates(entry, locations)) {
    const file = await regularFile(candidate);
    if (file === null || seen.has(file.path)) {
      continue;
    }
    seen.add(file.path);
    if (file.info.size === BigInt(entry.sizeBytes) && (await stableDigest(file)) === entry.sha256) {
      return file;
    }
  }
  return null;
}

export async function matchFile(path: string, entries: readonly CatalogEntry[]): Promise<{ entry: CatalogEntry; file: ExistingFile } | null> {
  const file = await regularFile(path);
  if (file === null) {
    return null;
  }
  const sized = entries.filter((entry) => BigInt(entry.sizeBytes) === file.info.size);
  if (sized.length === 0) {
    return null;
  }
  const digest = await stableDigest(file);
  const entry = sized.find((candidate) => candidate.sha256 === digest);
  return entry === undefined ? null : { entry, file };
}
