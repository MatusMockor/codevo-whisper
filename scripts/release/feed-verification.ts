import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseMacManifest, type FeedFile, type MacManifest } from './mac-manifest.ts';

export const REQUIRED_ARCHS = ['arm64', 'x64'] as const;

export type FeedReport = { manifest: MacManifest; archs: string[]; problems: string[] };

async function sha512Of(file: string): Promise<string> {
  const hash = createHash('sha512');
  await pipeline(createReadStream(file), hash);
  return hash.digest('base64');
}

async function sizeOf(file: string): Promise<number | null> {
  return stat(file).then(
    (info) => info.size,
    () => null,
  );
}

async function checkEntry(feedDir: string, entry: FeedFile): Promise<string | null> {
  if (basename(entry.url) !== entry.url || entry.url === '..') {
    return `${entry.url}: not a plain file name`;
  }
  const file = join(feedDir, entry.url);
  const size = await sizeOf(file);
  if (size === null) {
    return `${entry.url}: missing`;
  }
  if (size !== entry.size) {
    return `${entry.url}: size ${size} != ${entry.size}`;
  }
  if ((await sha512Of(file)) !== entry.sha512) {
    return `${entry.url}: sha512 mismatch`;
  }
  return null;
}

function zipArch(url: string): string | null {
  if (!url.endsWith('.zip')) {
    return null;
  }
  if (url.includes('-arm64-')) {
    return 'arm64';
  }
  if (url.includes('-x64-') && !url.includes('arm64')) {
    return 'x64';
  }
  return null;
}

function coveredArchs(manifest: MacManifest): string[] {
  const found = new Set(manifest.files.map((entry) => zipArch(entry.url)));
  return REQUIRED_ARCHS.filter((arch) => found.has(arch));
}

function primaryProblem(manifest: MacManifest): string | null {
  if (manifest.path === undefined) {
    return null;
  }
  const listed = manifest.files.some((entry) => entry.url === manifest.path && entry.sha512 === manifest.sha512);
  return listed ? null : `path ${manifest.path} does not match a listed file with the same sha512`;
}

export async function verifyFeed(manifestFile: string): Promise<FeedReport> {
  const manifest = parseMacManifest(await readFile(manifestFile, 'utf8'), manifestFile);
  const entryProblems = await Promise.all(manifest.files.map((entry) => checkEntry(dirname(manifestFile), entry)));
  const archs = coveredArchs(manifest);
  const archProblem = archs.length === REQUIRED_ARCHS.length ? null : `expected zip entries for ${REQUIRED_ARCHS.join(' and ')}, found: ${archs.join(', ') || 'none'}`;
  const problems = [...entryProblems, archProblem, primaryProblem(manifest)].filter((problem): problem is string => problem !== null);
  return { manifest, archs, problems };
}
