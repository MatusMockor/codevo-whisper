import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveHelperBinary } from '../src/main/helper/helper-binary';

describe('resolveHelperBinary', () => {
  it('uses the bundled resources when packaged', () => {
    const binary = resolveHelperBinary({ isPackaged: true, resourcesPath: '/App/Contents/Resources', appPath: '/ignored', arch: 'arm64' });

    expect(binary).toBe(join('/App/Contents/Resources', 'bin', 'arm64', 'codevo-input-helper'));
  });

  it('uses the native build output in development', () => {
    const binary = resolveHelperBinary({ isPackaged: false, resourcesPath: '/ignored', appPath: '/repo/apps/desktop', arch: 'x64', platform: 'darwin' });

    expect(binary).toBe(join('/repo', 'native', 'macos-helper', 'build', 'x64', 'codevo-input-helper'));
  });
});

it('resolves the staged Linux helper in development', () => {
  expect(resolveHelperBinary({ isPackaged: false, resourcesPath: '/ignored', appPath: '/repo/apps/desktop', arch: 'x64', platform: 'linux' })).toBe(join('/repo/apps/desktop/resources/bin/x64/codevo-input-helper'));
});
