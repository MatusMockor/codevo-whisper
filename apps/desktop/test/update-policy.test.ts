import { describe, expect, it } from 'vitest';
import { resolveUpdateMode, type PlatformFacts } from '../src/main/updates/update-policy';

const PACKAGED_MAC: PlatformFacts = { platform: 'darwin', isPackaged: true, appImage: undefined };

describe('resolveUpdateMode', () => {
  it('updates a packaged macOS app in the app', () => {
    expect(resolveUpdateMode(PACKAGED_MAC)).toBe('in-app');
  });

  it('updates a Linux AppImage in the app', () => {
    expect(resolveUpdateMode({ platform: 'linux', isPackaged: true, appImage: '/home/user/Codevo-Whisper.AppImage' })).toBe('in-app');
  });

  it('only shows a notice for every other Linux package', () => {
    expect(resolveUpdateMode({ platform: 'linux', isPackaged: true, appImage: undefined })).toBe('manual');
    expect(resolveUpdateMode({ platform: 'linux', isPackaged: true, appImage: '' })).toBe('manual');
  });

  it('does not update on platforms without a release', () => {
    expect(resolveUpdateMode({ platform: 'win32', isPackaged: true, appImage: undefined })).toBe('unsupported');
  });

  it('does not update an unpackaged build', () => {
    expect(resolveUpdateMode({ ...PACKAGED_MAC, isPackaged: false })).toBe('unsupported');
    expect(resolveUpdateMode({ platform: 'linux', isPackaged: false, appImage: '/tmp/a.AppImage' })).toBe('unsupported');
  });
});
