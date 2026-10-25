import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveUserDataDir } from '../src/main/app/user-data-dir';

const appDataDir = join('/Users', 'owner', 'Library', 'Application Support');

describe('resolveUserDataDir', () => {
  it('uses the product name for the packaged app and ignores the override', () => {
    expect(resolveUserDataDir({ isPackaged: true, appDataDir, override: '/tmp/elsewhere' })).toBe(join(appDataDir, 'Codevo Whisper'));
  });

  it('uses the override when not packaged', () => {
    expect(resolveUserDataDir({ isPackaged: false, appDataDir, override: '/tmp/cw-e2e' })).toBe('/tmp/cw-e2e');
  });

  it('keeps unpackaged runs away from the real settings', () => {
    expect(resolveUserDataDir({ isPackaged: false, appDataDir, override: undefined })).toBe(join(appDataDir, 'Codevo Whisper Dev'));
    expect(resolveUserDataDir({ isPackaged: false, appDataDir, override: '' })).toBe(join(appDataDir, 'Codevo Whisper Dev'));
  });
});
