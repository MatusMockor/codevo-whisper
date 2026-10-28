import { describe, expect, it } from 'vitest';
import { IDLE, nextActivity, statusLine, trayIconKind, type TrayActivity } from '../src/main/tray/tray-status';

const RIGHT_CONTROL = { hotkey: { kind: 'modifiers', keycodes: [62], label: 'Pravý ⌃ Control' } } as const;
const ERROR: TrayActivity = { kind: 'error', message: 'Nemáte stiahnutý model' };

describe('tray status', () => {
  it('follows recording and processing and returns to idle after a result', () => {
    const recording = nextActivity(IDLE, { kind: 'recording', elapsedMs: 0, level: 0, language: 'SK' });
    const processing = nextActivity(recording, { kind: 'processing' });

    expect(recording).toEqual({ kind: 'recording' });
    expect(processing).toEqual({ kind: 'processing' });
    expect(nextActivity(processing, { kind: 'inserted', appName: 'Notes' })).toEqual(IDLE);
    expect(nextActivity(processing, { kind: 'hidden' })).toEqual(IDLE);
  });

  it('keeps an error after the overlay hides until the next session', () => {
    const error = nextActivity(IDLE, { kind: 'error', message: 'Nemáte stiahnutý model', action: 'open-settings' });

    expect(nextActivity(error, { kind: 'hidden' })).toEqual(ERROR);
    expect(nextActivity(error, { kind: 'recording', elapsedMs: 0, level: 0, language: 'SK' })).toEqual({ kind: 'recording' });
  });

  it('shows paused unless a session is running', () => {
    expect(trayIconKind(IDLE, true)).toBe('paused');
    expect(trayIconKind(ERROR, true)).toBe('paused');
    expect(trayIconKind({ kind: 'processing' }, true)).toBe('processing');
    expect(trayIconKind(ERROR, false)).toBe('error');
  });

  it('describes the state in the status line', () => {
    expect(statusLine(IDLE, false, RIGHT_CONTROL)).toBe('Pripravené · Pravý ⌃ Control');
    expect(statusLine(IDLE, false, { hotkey: null })).toBe('Nastavte klávesovú skratku v Nastaveniach');
    expect(statusLine(IDLE, true, RIGHT_CONTROL)).toBe('Diktovanie je pozastavené');
    expect(statusLine({ kind: 'recording' }, true, RIGHT_CONTROL)).toBe('Nahrávam…');
    expect(statusLine({ kind: 'processing' }, false, RIGHT_CONTROL)).toBe('Spracúvam…');
    expect(statusLine(ERROR, false, RIGHT_CONTROL)).toBe('Nemáte stiahnutý model');
  });
});
