import { constants } from 'node:fs';
import { lstat, open, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Logger } from '../logging/logger';
import { isOwnedDirectory, ownedByUs } from './file-ownership';
import type { UpdateCacheLocator } from './update-cache-dir';
import { compareVersions, parseVersion } from './version-order';

export type PendingUpdatePrunerDeps = { locator: UpdateCacheLocator; currentVersion: string; logger: Logger };

const PENDING_DIR = 'pending';

const UPDATE_INFO_FILE = 'update-info.json';

const UPDATE_INFO_MAX_BYTES = 64 * 1024;

const ARTIFACT_VERSION = /^codevo-whisper-(.+)-[^-]+-[^-.]+\.[^.]+$/;

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function ownedDirectoryExists(dir: string): Promise<boolean> {
  const stats = await lstat(dir).catch((error: unknown) => {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  });
  if (stats === null) {
    return false;
  }
  if (!isOwnedDirectory(stats)) {
    throw new Error('The update cache is not a private directory');
  }
  return true;
}

async function readUpdateInfo(file: string): Promise<string | null> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch((error: unknown) => {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  });
  if (handle === null) {
    return null;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || !ownedByUs(stats) || stats.size > UPDATE_INFO_MAX_BYTES) {
      throw new Error('The pending update info is not a regular file');
    }
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

function pendingVersion(updateInfo: string): string | null {
  const info: unknown = JSON.parse(updateInfo);
  const fileName = typeof info === 'object' && info !== null && 'fileName' in info ? info.fileName : undefined;
  if (typeof fileName !== 'string' || basename(fileName) !== fileName) {
    return null;
  }
  return ARTIFACT_VERSION.exec(fileName)?.[1] ?? null;
}

export class PendingUpdatePruner {
  constructor(private readonly deps: PendingUpdatePrunerDeps) {}

  async prune(): Promise<void> {
    try {
      await this.removeInstalled();
    } catch (error) {
      this.deps.logger.warn('The update cache could not be cleaned', error);
    }
  }

  private async removeInstalled(): Promise<void> {
    const cacheDir = await this.deps.locator.cacheDir();
    if (cacheDir === null || !(await ownedDirectoryExists(cacheDir))) {
      return;
    }
    const pending = join(cacheDir, PENDING_DIR);
    if (!(await ownedDirectoryExists(pending))) {
      return;
    }
    const updateInfo = await readUpdateInfo(join(pending, UPDATE_INFO_FILE));
    const version = updateInfo === null ? null : pendingVersion(updateInfo);
    if (version === null || !this.installed(version)) {
      return;
    }
    await rm(pending, { recursive: true, force: true });
    this.deps.logger.info('Removed the installed update from the update cache', { version });
  }

  private installed(version: string): boolean {
    const pending = parseVersion(version);
    const current = parseVersion(this.deps.currentVersion);
    return pending !== null && current !== null && compareVersions(pending, current) <= 0;
  }
}
