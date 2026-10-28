import { describe, expect, it } from 'vitest';
import { appBundlePath } from '../src/main/system/app-bundle';
import { AppReveal } from '../src/main/system/app-reveal';
import { RecordingDesktopShell } from '../src/main/system/desktop-shell';

const PACKAGED_EXE = '/Applications/Codevo Whisper.app/Contents/MacOS/Codevo Whisper';

describe('appBundlePath', () => {
  it('resolves the running .app bundle from its executable', () => {
    expect(appBundlePath(PACKAGED_EXE)).toBe('/Applications/Codevo Whisper.app');
    expect(appBundlePath('/Users/me/Apps/Outer.app/Contents/Frameworks/Inner.app/Contents/MacOS/Inner')).toBe('/Users/me/Apps/Outer.app/Contents/Frameworks/Inner.app');
  });

  it('falls back to the executable outside an .app bundle', () => {
    expect(appBundlePath('/usr/local/bin/electron')).toBe('/usr/local/bin/electron');
    expect(appBundlePath('/opt/Codevo/Contents/MacOS/Codevo Whisper')).toBe('/opt/Codevo/Contents/MacOS/Codevo Whisper');
    expect(appBundlePath('/opt/Codevo.app/MacOS/Codevo Whisper')).toBe('/opt/Codevo.app/MacOS/Codevo Whisper');
  });
});

describe('AppReveal', () => {
  it('reveals the app bundle in Finder on macOS', () => {
    const shell = new RecordingDesktopShell();
    const reveal = new AppReveal({ platform: 'darwin', executablePath: PACKAGED_EXE, shell });

    expect(reveal.available()).toBe(true);
    reveal.reveal();

    expect(shell.revealed).toEqual(['/Applications/Codevo Whisper.app']);
  });

  it('is unavailable and does nothing on other platforms', () => {
    const shell = new RecordingDesktopShell();
    const reveal = new AppReveal({ platform: 'linux', executablePath: '/opt/codevo-whisper/codevo-whisper', shell });

    expect(reveal.available()).toBe(false);
    reveal.reveal();

    expect(shell.revealed).toEqual([]);
  });
});
