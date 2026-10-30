import { describe, expect, it } from 'vitest';
import { linuxPackageName } from '../release/linux-package.ts';

describe('linuxPackageName', () => {
  it('builds the names electron-builder 26 gives the AppImage and deb', () => {
    expect(linuxPackageName('0.2.2', 'x64', 'AppImage')).toBe('codevo-whisper-0.2.2-x86_64-linux.AppImage');
    expect(linuxPackageName('0.2.2', 'x64', 'deb')).toBe('codevo-whisper-0.2.2-amd64-linux.deb');
    expect(linuxPackageName('0.2.2', 'arm64', 'AppImage')).toBe('codevo-whisper-0.2.2-arm64-linux.AppImage');
    expect(linuxPackageName('0.2.2-beta.1', 'arm64', 'deb')).toBe('codevo-whisper-0.2.2-beta.1-arm64-linux.deb');
  });
});
