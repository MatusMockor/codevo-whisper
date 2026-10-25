import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPackageType } from '../src/main/updates/package-type';
import { resolveUpdateMode, type PlatformFacts } from '../src/main/updates/update-policy';

const PACKAGED_MAC: PlatformFacts = { platform: 'darwin', isPackaged: true, appImage: undefined, packageType: null };
const APPIMAGE = '/home/user/Codevo-Whisper.AppImage';

describe('resolveUpdateMode', () => {
  it('updates a packaged macOS app in the app', () => {
    expect(resolveUpdateMode(PACKAGED_MAC)).toBe('in-app');
  });

  it('updates a Linux AppImage in the app', () => {
    expect(resolveUpdateMode({ platform: 'linux', isPackaged: true, appImage: APPIMAGE, packageType: null })).toBe('in-app');
  });

  it('only shows a notice for every other Linux package', () => {
    expect(resolveUpdateMode({ platform: 'linux', isPackaged: true, appImage: undefined, packageType: null })).toBe('manual');
    expect(resolveUpdateMode({ platform: 'linux', isPackaged: true, appImage: '', packageType: null })).toBe('manual');
    expect(resolveUpdateMode({ platform: 'linux', isPackaged: true, appImage: undefined, packageType: 'deb' })).toBe('manual');
  });

  it('keeps a deb manual even when APPIMAGE is set in the environment', () => {
    expect(resolveUpdateMode({ platform: 'linux', isPackaged: true, appImage: APPIMAGE, packageType: 'deb' })).toBe('manual');
    expect(resolveUpdateMode({ platform: 'linux', isPackaged: true, appImage: APPIMAGE, packageType: 'rpm' })).toBe('manual');
  });

  it('does not update on platforms without a release', () => {
    expect(resolveUpdateMode({ platform: 'win32', isPackaged: true, appImage: undefined, packageType: null })).toBe('unsupported');
  });

  it('does not update an unpackaged build', () => {
    expect(resolveUpdateMode({ ...PACKAGED_MAC, isPackaged: false })).toBe('unsupported');
    expect(resolveUpdateMode({ platform: 'linux', isPackaged: false, appImage: APPIMAGE, packageType: null })).toBe('unsupported');
  });
});

describe('readPackageType', () => {
  let resources: string;

  beforeEach(async () => {
    resources = await mkdtemp(join(tmpdir(), 'cw-package-type-'));
  });

  afterEach(async () => {
    await rm(resources, { recursive: true, force: true });
  });

  it('reads the package type electron-builder writes into the resources of a deb', async () => {
    await writeFile(join(resources, 'package-type'), 'deb\n');

    expect(readPackageType(resources)).toBe('deb');
  });

  it('returns null without the file or for an empty one', async () => {
    expect(readPackageType(resources)).toBeNull();
    await writeFile(join(resources, 'package-type'), '  \n');
    expect(readPackageType(resources)).toBeNull();
  });
});
