import { describe, expect, it } from 'vitest';
import { focusHandlers } from '../src/main/ipc/focus-handlers';
import { IpcValidationError } from '../src/main/ipc/validate';
import { SectionFocus, type SectionWindow } from '../src/main/windows/section-focus';
import { focusTarget } from '../src/renderer/focus-target';
import { focusPage, sectionPage } from '../src/shared/section-focus';

type WindowCall = { kind: 'open'; page: string | undefined } | { kind: 'send'; event: string; payload: unknown };

function recordingWindow(calls: WindowCall[]): SectionWindow {
  return {
    open: (page) => calls.push({ kind: 'open', page }),
    send: (event, payload) => calls.push({ kind: 'send', event, payload }),
  };
}

describe('SectionFocus', () => {
  it('opens the page that owns the section, announces it and hands it out exactly once', async () => {
    const calls: WindowCall[] = [];
    const focus = new SectionFocus(recordingWindow(calls));
    const handlers = focusHandlers({ sectionFocus: focus });

    expect(await handlers.takeSectionFocus()).toBeNull();
    focus.reveal('local-model');

    expect(calls).toEqual([
      { kind: 'open', page: 'transcription' },
      { kind: 'send', event: 'section-focus-requested', payload: { kind: 'section', section: 'local-model' } },
    ]);
    expect(await handlers.takeSectionFocus()).toEqual({ kind: 'section', section: 'local-model' });
    expect(await handlers.takeSectionFocus()).toBeNull();
    await expect(handlers.takeSectionFocus('local-model')).rejects.toThrow(IpcValidationError);
  });

  it('opens Settings at a single setting row and hands it to the renderer as a setting target', async () => {
    const calls: WindowCall[] = [];
    const focus = new SectionFocus(recordingWindow(calls));

    focus.revealSetting('languages');

    expect(calls).toEqual([
      { kind: 'open', page: 'settings' },
      { kind: 'send', event: 'section-focus-requested', payload: { kind: 'setting', setting: 'languages' } },
    ]);
    const request = await focusHandlers({ sectionFocus: focus }).takeSectionFocus();
    expect(request).toEqual({ kind: 'setting', setting: 'languages' });
    expect(request === null ? null : focusTarget(request)).toEqual({ page: 'settings', setting: 'languages' });
    expect(focusTarget({ kind: 'section', section: 'server' })).toEqual({ page: 'transcription', section: 'server' });
    expect(focusPage({ kind: 'section', section: 'microphone' })).toBe('settings');
  });

  it('keeps dictation sections on Settings and moves transcription sections to Prepis', () => {
    expect(sectionPage('dictation')).toBe('settings');
    expect(sectionPage('ai')).toBe('settings');
    expect(sectionPage('engine')).toBe('transcription');
    expect(sectionPage('server')).toBe('transcription');
    expect(sectionPage('local-model')).toBe('transcription');
  });
});
