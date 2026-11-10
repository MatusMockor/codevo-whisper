import { describe, expect, it } from 'vitest';
import { focusHandlers } from '../src/main/ipc/focus-handlers';
import { IpcValidationError } from '../src/main/ipc/validate';
import { SectionFocus, type SectionWindow } from '../src/main/windows/section-focus';
import { sectionPage } from '../src/shared/section-focus';

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
      { kind: 'send', event: 'section-focus-requested', payload: 'local-model' },
    ]);
    expect(await handlers.takeSectionFocus()).toBe('local-model');
    expect(await handlers.takeSectionFocus()).toBeNull();
    await expect(handlers.takeSectionFocus('local-model')).rejects.toThrow(IpcValidationError);
  });

  it('keeps dictation sections on Settings and moves transcription sections to Prepis', () => {
    expect(sectionPage('dictation')).toBe('settings');
    expect(sectionPage('ai')).toBe('settings');
    expect(sectionPage('engine')).toBe('transcription');
    expect(sectionPage('server')).toBe('transcription');
    expect(sectionPage('local-model')).toBe('transcription');
  });
});
