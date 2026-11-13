import { describe, expect, it } from 'vitest';
import { armedSessionShortcuts, recordedSessionBinding } from '../src/main/session/session-shortcuts';
import { SETTINGS_FIELDS } from '../src/main/settings/settings-fields';
import { sanitizeSettings } from '../src/main/settings/sanitize-settings';
import type { Members, Modifier } from '../src/shared/hotkey';
import { DEFAULT_SESSION_SHORTCUTS, sessionShortcutLabel } from '../src/shared/session-shortcuts';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';

const X11 = 0x10000;
const EVDEV = 0x20000;
const AI_READY: Partial<Settings> = { aiBaseUrl: 'http://127.0.0.1:11434/v1', aiModel: 'qwen2.5:1.5b' };

function key(keycode: number, modifiers: Members<Modifier>) {
  return { kind: 'key', keycode, modifiers, label: 'test' } as const;
}

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

describe('in-dictation shortcuts', () => {
  it('arms Esc, the AI toggle and the language cycle from settings', () => {
    expect(armedSessionShortcuts(settings(AI_READY), 'linux')).toEqual([
      { action: 'cancel', key: 'escape', modifiers: [] },
      { action: 'toggle-polish', key: 'a', modifiers: ['control', 'alt'] },
      { action: 'cycle-language', key: 'j', modifiers: ['control', 'alt'] },
    ]);
  });

  it('leaves the AI toggle unarmed while AI polish is not configured', () => {
    expect(armedSessionShortcuts(settings(), 'linux').map(({ action }) => action)).toEqual(['cancel', 'cycle-language']);
  });

  it.each([
    ['X11', 'linux', X11 + 36 + 8, ['control', 'alt']],
    ['Wayland', 'linux', EVDEV + 36, ['control', 'alt', 'shift']],
    ['macOS', 'darwin', 38, ['control', 'alt']],
    ['macOS with fewer modifiers', 'darwin', 38, ['alt']],
  ] as const)('drops a shortcut that overlaps the dictation hotkey on %s', (_case, platform, keycode, modifiers) => {
    const armed = armedSessionShortcuts(settings({ ...AI_READY, hotkey: key(keycode, modifiers) }), platform);
    expect(armed.map(({ action }) => action)).toEqual(['cancel', 'toggle-polish']);
  });

  it('keeps a shortcut whose key differs from the dictation hotkey or whose modifiers do not nest', () => {
    expect(armedSessionShortcuts(settings({ ...AI_READY, hotkey: key(X11 + 30 + 8, ['shift']) }), 'linux')).toHaveLength(3);
    expect(armedSessionShortcuts(settings({ ...AI_READY, hotkey: { kind: 'modifiers', keycodes: [63], label: 'Fn' } }), 'darwin')).toHaveLength(3);
  });

  it.each([
    ['X11', 'linux', X11 + 25 + 8, 'p'],
    ['Wayland', 'linux', EVDEV + 25, 'p'],
    ['macOS', 'darwin', 35, 'p'],
    ['X11 function key', 'linux', X11 + 88 + 8, 'f12'],
    ['macOS digit', 'darwin', 29, '0'],
  ] as const)('reads a recorded %s shortcut as a portable binding', (_case, platform, keycode, expected) => {
    expect(recordedSessionBinding(key(keycode, ['control', 'shift']), platform)).toEqual({ key: expected, modifiers: ['control', 'shift'] });
  });

  it.each([
    ['Esc', key(EVDEV + 1, ['control'])],
    ['an unknown key', key(EVDEV + 57, ['control'])],
    ['Fn', key(35, ['fn'])],
    ['a modifier-only binding', { kind: 'modifiers', keycodes: [EVDEV + 29], label: 'Ctrl' } as const],
  ])('refuses a recorded binding with %s', (_case, recorded) => {
    expect(recordedSessionBinding(recorded, 'linux')).toBeNull();
  });

  it('labels a binding for the platform', () => {
    expect(sessionShortcutLabel({ key: 'a', modifiers: ['control', 'alt'] }, true)).toBe('⌃⌥A');
    expect(sessionShortcutLabel({ key: 'f5', modifiers: ['meta', 'shift'] }, false)).toBe('Shift+Super+F5');
  });

  it.each([
    ['a binding without modifiers', { ...DEFAULT_SESSION_SHORTCUTS, 'cycle-language': { key: 'j', modifiers: [] } }],
    ['Esc', { ...DEFAULT_SESSION_SHORTCUTS, 'cycle-language': { key: 'escape', modifiers: ['control'] } }],
    ['an unknown modifier', { ...DEFAULT_SESSION_SHORTCUTS, 'cycle-language': { key: 'j', modifiers: ['fn'] } }],
    ['a repeated modifier', { ...DEFAULT_SESSION_SHORTCUTS, 'cycle-language': { key: 'j', modifiers: ['alt', 'alt'] } }],
    ['overlapping shortcuts', { 'toggle-polish': { key: 'j', modifiers: ['control'] }, 'cycle-language': { key: 'j', modifiers: ['control', 'alt'] } }],
    ['a missing action', { 'toggle-polish': DEFAULT_SESSION_SHORTCUTS['toggle-polish'] }],
    ['an extra field', { ...DEFAULT_SESSION_SHORTCUTS, 'cycle-language': { key: 'j', modifiers: ['alt'], label: 'Alt+J' } }],
  ])('rejects stored shortcuts with %s and falls back to the defaults', (_case, value) => {
    expect(SETTINGS_FIELDS.sessionShortcuts(value)).toBe(false);
    expect(sanitizeSettings({ sessionShortcuts: value }).sessionShortcuts).toEqual(DEFAULT_SESSION_SHORTCUTS);
  });

  it('keeps valid stored shortcuts', () => {
    const stored = { 'toggle-polish': { key: 'p', modifiers: ['meta'] }, 'cycle-language': { key: 'f2', modifiers: ['shift'] } };
    expect(sanitizeSettings({ sessionShortcuts: stored }).sessionShortcuts).toEqual(stored);
  });
});
