import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appCacheBase, AppUpdateConfigCacheLocator, updaterCacheDirName } from '../src/main/updates/update-cache-dir';

let resources: string;

beforeEach(async () => {
  resources = await mkdtemp(join(tmpdir(), 'cw-update-cache-dir-'));
});

afterEach(async () => {
  await rm(resources, { recursive: true, force: true });
});

describe('appCacheBase', () => {
  it('uses the same cache base as electron-updater', () => {
    expect(appCacheBase({ platform: 'darwin', home: '/Users/eva', xdgCacheHome: '/tmp/xdg' })).toBe('/Users/eva/Library/Caches');
    expect(appCacheBase({ platform: 'linux', home: '/home/eva', xdgCacheHome: '/tmp/xdg' })).toBe('/tmp/xdg');
    expect(appCacheBase({ platform: 'linux', home: '/home/eva', xdgCacheHome: '' })).toBe('/home/eva/.cache');
    expect(appCacheBase({ platform: 'linux', home: '/home/eva', xdgCacheHome: undefined })).toBe('/home/eva/.cache');
    expect(appCacheBase({ platform: 'win32', home: 'C:\\Users\\eva', xdgCacheHome: undefined })).toBeNull();
  });
});

describe('updaterCacheDirName', () => {
  it('reads the plain and the quoted name electron-builder writes', () => {
    expect(updaterCacheDirName('provider: github\nupdaterCacheDirName: codevo-whisper-updater\n')).toBe('codevo-whisper-updater');
    expect(updaterCacheDirName("provider: github\nupdaterCacheDirName: '@codevo-whisperdesktop-updater'\n")).toBe('@codevo-whisperdesktop-updater');
    expect(updaterCacheDirName('updaterCacheDirName: "codevo-whisper-updater"  \nrepo: x\n')).toBe('codevo-whisper-updater');
  });

  it('rejects a missing name and every name that leaves the cache base', () => {
    expect(updaterCacheDirName('provider: github\n')).toBeNull();
    expect(updaterCacheDirName('updaterCacheDirName: \n')).toBeNull();
    expect(updaterCacheDirName("updaterCacheDirName: ''\n")).toBeNull();
    expect(updaterCacheDirName('updaterCacheDirName: ..\n')).toBeNull();
    expect(updaterCacheDirName('updaterCacheDirName: ../escape\n')).toBeNull();
    expect(updaterCacheDirName('updaterCacheDirName: /tmp/escape\n')).toBeNull();
  });
});

describe('AppUpdateConfigCacheLocator', () => {
  it('joins the cache base with the name from app-update.yml', async () => {
    await writeFile(join(resources, 'app-update.yml'), "provider: github\nupdaterCacheDirName: '@codevo-whisperdesktop-updater'\n");

    const locator = new AppUpdateConfigCacheLocator({ resourcesPath: resources, base: '/Users/eva/Library/Caches' });

    expect(await locator.cacheDir()).toBe('/Users/eva/Library/Caches/@codevo-whisperdesktop-updater');
  });

  it('has no cache directory without a cache base or a valid name', async () => {
    await writeFile(join(resources, 'app-update.yml'), 'provider: github\n');

    expect(await new AppUpdateConfigCacheLocator({ resourcesPath: resources, base: null }).cacheDir()).toBeNull();
    expect(await new AppUpdateConfigCacheLocator({ resourcesPath: resources, base: '/cache' }).cacheDir()).toBeNull();
  });
});
