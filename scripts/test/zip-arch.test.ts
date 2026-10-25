import { describe, expect, it } from 'vitest';
import { zipArch } from '../release/zip-arch.ts';

describe('zipArch', () => {
  it('detects the arm64 zip', () => {
    expect(zipArch('codevo-whisper-1.2.0-arm64-mac.zip')).toBe('arm64');
  });

  it('detects the x64 zip', () => {
    expect(zipArch('codevo-whisper-1.2.0-x64-mac.zip')).toBe('x64');
  });

  it('ignores files that are not zips', () => {
    expect(zipArch('codevo-whisper-1.2.0-x64-mac.dmg')).toBeNull();
    expect(zipArch('codevo-whisper-1.2.0-x64-mac.zip.blockmap')).toBeNull();
  });

  it('never treats a name containing arm64 as x64', () => {
    expect(zipArch('codevo-whisper-1.2.0-x64-arm64-mac.zip')).toBe('arm64');
    expect(zipArch('codevo-whisper-arm64-1.2.0-x64-mac.zip')).toBeNull();
  });

  it('returns null without an arch token', () => {
    expect(zipArch('codevo-whisper-1.2.0-mac.zip')).toBeNull();
  });
});
