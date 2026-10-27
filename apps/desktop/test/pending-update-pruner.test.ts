import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PendingUpdatePruner } from '../src/main/updates/pending-update-pruner';
import { AppUpdateConfigCacheLocator } from '../src/main/updates/update-cache-dir';
import { RecordingLogger } from './recording-logger';

const CACHE_NAME = '@codevo-whisperdesktop-updater';

let scratch: string;
let resources: string;
let base: string;
let cacheDir: string;
let pendingDir: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-pending-pruner-'));
  resources = join(scratch, 'Resources');
  base = join(scratch, 'Caches');
  cacheDir = join(base, CACHE_NAME);
  pendingDir = join(cacheDir, 'pending');
  await mkdir(resources, { recursive: true });
  await writeFile(join(resources, 'app-update.yml'), `owner: MatusMockor\nrepo: codevo-whisper\nprovider: github\nupdaterCacheDirName: '${CACHE_NAME}'\n`);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function pruner(currentVersion: string) {
  const logger = new RecordingLogger();
  const locator = new AppUpdateConfigCacheLocator({ resourcesPath: resources, base });
  return { logger, pruner: new PendingUpdatePruner({ locator, currentVersion, logger }) };
}

async function downloaded(version: string, dir = pendingDir): Promise<void> {
  const fileName = `codevo-whisper-${version}-arm64-mac.zip`;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, fileName), 'PK update');
  await writeFile(join(dir, 'current.blockmap'), 'blockmap');
  await writeFile(join(dir, 'update-info.json'), JSON.stringify({ fileName, sha512: 'c2hh', isAdminRightsRequired: false }));
  await writeFile(join(cacheDir, 'update.zip'), 'PK update');
  await writeFile(join(cacheDir, 'current.blockmap'), 'blockmap');
}

async function entries(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}

describe('PendingUpdatePruner', () => {
  it('removes the pending copy of the installed version and keeps the differential base', async () => {
    await downloaded('1.2.0');
    const { pruner: subject, logger } = pruner('1.2.0');

    await subject.prune();

    expect(await entries(cacheDir)).toEqual(['current.blockmap', 'update.zip']);
    expect(await readFile(join(cacheDir, 'update.zip'), 'utf8')).toBe('PK update');
    expect(logger.infos).toEqual([{ message: 'Removed the installed update from the update cache', detail: { version: '1.2.0' } }]);
    expect(logger.warns).toEqual([]);
  });

  it('removes a pending copy older than the running version', async () => {
    await downloaded('1.2.0-beta.2');
    const { pruner: subject } = pruner('1.2.0');

    await subject.prune();

    expect(await entries(cacheDir)).toEqual(['current.blockmap', 'update.zip']);
  });

  it('keeps a downloaded update that is newer than the running version', async () => {
    await downloaded('1.10.0');
    const { pruner: subject, logger } = pruner('1.9.3');

    await subject.prune();

    expect(await entries(pendingDir)).toEqual(['codevo-whisper-1.10.0-arm64-mac.zip', 'current.blockmap', 'update-info.json']);
    expect(logger.infos).toEqual([]);
  });

  it('keeps a newer prerelease of the running version line', async () => {
    await downloaded('1.2.1-beta.1');
    const { pruner: subject } = pruner('1.2.0');

    await subject.prune();

    expect(await entries(pendingDir)).toHaveLength(3);
  });

  it('does nothing when there is no cache, no pending directory or no update info', async () => {
    const { pruner: subject, logger } = pruner('1.2.0');
    await subject.prune();

    await mkdir(cacheDir, { recursive: true });
    await subject.prune();

    await mkdir(pendingDir);
    await writeFile(join(pendingDir, 'temp-codevo-whisper-1.2.0-arm64-mac.zip'), 'PK partial');
    await subject.prune();

    expect(await entries(pendingDir)).toEqual(['temp-codevo-whisper-1.2.0-arm64-mac.zip']);
    expect(logger.infos).toEqual([]);
    expect(logger.warns).toEqual([]);
  });

  it('keeps the pending directory and logs when the update info is malformed', async () => {
    await downloaded('1.2.0');
    await writeFile(join(pendingDir, 'update-info.json'), '{"fileName": ');
    const { pruner: subject, logger } = pruner('1.2.0');

    await subject.prune();

    expect(await entries(pendingDir)).toHaveLength(3);
    expect(logger.warns.map((entry) => entry.message)).toEqual(['The update cache could not be cleaned']);
  });

  it('keeps the pending directory when the update info names no known artifact', async () => {
    await downloaded('1.2.0');
    const invalid = [{ fileName: '../codevo-whisper-1.2.0-arm64-mac.zip' }, { fileName: 'other-1.2.0-arm64-mac.zip' }, { fileName: 42 }, null, { sha512: 'c2hh' }];
    const { pruner: subject } = pruner('1.2.0');

    for (const info of invalid) {
      await writeFile(join(pendingDir, 'update-info.json'), JSON.stringify(info));
      await subject.prune();
    }

    expect(await entries(pendingDir)).toHaveLength(3);
  });

  it('keeps the pending directory when the running version cannot be read', async () => {
    await downloaded('1.2.0');
    const { pruner: subject } = pruner('not-a-version');

    await subject.prune();

    expect(await entries(pendingDir)).toHaveLength(3);
  });

  it('refuses a symlinked pending directory and leaves its target alone', async () => {
    const elsewhere = join(scratch, 'elsewhere');
    await mkdir(cacheDir, { recursive: true });
    await downloaded('1.2.0', elsewhere);
    await symlink(elsewhere, pendingDir);
    const { pruner: subject, logger } = pruner('1.2.0');

    await subject.prune();

    expect(await entries(elsewhere)).toEqual(['codevo-whisper-1.2.0-arm64-mac.zip', 'current.blockmap', 'update-info.json']);
    expect(await entries(cacheDir)).toEqual(['current.blockmap', 'pending', 'update.zip']);
    expect(logger.warns.map((entry) => entry.message)).toEqual(['The update cache could not be cleaned']);
  });

  it('removes a symlink inside the pending directory without following it', async () => {
    await downloaded('1.2.0');
    const outside = join(scratch, 'keep-me');
    await writeFile(outside, 'not part of the cache');
    await symlink(outside, join(pendingDir, 'link'));
    const { pruner: subject } = pruner('1.2.0');

    await subject.prune();

    expect(await entries(cacheDir)).toEqual(['current.blockmap', 'update.zip']);
    expect(await readFile(outside, 'utf8')).toBe('not part of the cache');
  });

  it('refuses a symlinked update info file', async () => {
    await downloaded('1.2.0');
    const outside = join(scratch, 'update-info.json');
    await writeFile(outside, JSON.stringify({ fileName: 'codevo-whisper-1.2.0-arm64-mac.zip' }));
    await rm(join(pendingDir, 'update-info.json'));
    await symlink(outside, join(pendingDir, 'update-info.json'));
    const { pruner: subject, logger } = pruner('1.2.0');

    await subject.prune();

    expect(await entries(pendingDir)).toHaveLength(3);
    expect(logger.warns.map((entry) => entry.message)).toEqual(['The update cache could not be cleaned']);
  });

  it('refuses a symlinked cache directory', async () => {
    const elsewhere = join(scratch, 'elsewhere-cache');
    await mkdir(elsewhere);
    await mkdir(base, { recursive: true });
    await symlink(elsewhere, cacheDir);
    await downloaded('1.2.0', join(elsewhere, 'pending'));
    const { pruner: subject } = pruner('1.2.0');

    await subject.prune();

    expect(await entries(join(elsewhere, 'pending'))).toHaveLength(3);
  });

  it('logs and keeps going when the update configuration is missing', async () => {
    await downloaded('1.2.0');
    await rm(join(resources, 'app-update.yml'));
    const { pruner: subject, logger } = pruner('1.2.0');

    await expect(subject.prune()).resolves.toBeUndefined();

    expect(await entries(pendingDir)).toHaveLength(3);
    expect(logger.warns.map((entry) => entry.message)).toEqual(['The update cache could not be cleaned']);
  });
});
