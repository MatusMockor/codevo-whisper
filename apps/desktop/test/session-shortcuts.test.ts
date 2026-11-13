import { describe, expect, it } from 'vitest';
import { armedSessionShortcuts, recordedSessionBinding, shortcutsConflict } from '../src/main/session/session-shortcuts';
import { SETTINGS_FIELDS } from '../src/main/settings/settings-fields';
import { sanitizeSettings } from '../src/main/settings/sanitize-settings';
import type { Members, Modifier } from '../src/shared/hotkey';
import { conflicts, DEFAULT_SESSION_SHORTCUTS, sessionShortcutLabel, type Trigger } from '../src/shared/session-shortcuts';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';

const X11 = 0x10000;
const EVDEV = 0x20000;
const HOTKEY: ReadonlySet<'hotkey'> = new Set(['hotkey']);
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
  ] as const)('drops a shortcut that overlaps the dictation hotkey on %s', (_case, platform, keycode, modifiers) => {
    const armed = armedSessionShortcuts(settings({ ...AI_READY, hotkey: key(keycode, modifiers) }), platform);
    expect(armed.map(({ action }) => action)).toEqual(['cancel', 'toggle-polish']);
  });

  it('drops every shortcut a modifier-only dictation hotkey fires on', () => {
    const hotkey = { kind: 'modifiers', keycodes: [X11 + 37], label: 'Ctrl' } as const;
    expect(armedSessionShortcuts(settings({ ...AI_READY, hotkey }), 'linux').map(({ action }) => action)).toEqual(['cancel']);
    const mac = { kind: 'modifiers', keycodes: [58, 59], label: '⌃⌥' } as const;
    expect(armedSessionShortcuts(settings({ ...AI_READY, hotkey: mac }), 'darwin').map(({ action }) => action)).toEqual(['cancel']);
  });

  it('keeps a shortcut that no single key press fires together with the dictation hotkey', () => {
    expect(armedSessionShortcuts(settings({ ...AI_READY, hotkey: key(X11 + 30 + 8, ['shift']) }), 'linux')).toHaveLength(3);
    expect(armedSessionShortcuts(settings({ ...AI_READY, hotkey: key(38, ['alt']) }), 'darwin')).toHaveLength(3);
    expect(armedSessionShortcuts(settings({ ...AI_READY, hotkey: { kind: 'modifiers', keycodes: [X11 + 37, X11 + 50], label: 'Ctrl+Shift' } }), 'linux')).toHaveLength(3);
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
    ['shortcuts one press fires together', { 'toggle-polish': { key: 'j', modifiers: ['control'] }, 'cycle-language': { key: 'j', modifiers: ['alt'] } }],
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

  const subset = (keyName: string, ...modifiers: string[]): Trigger => ({ match: 'subset', key: keyName, modifiers });
  const exact = (keyName: string, ...modifiers: string[]): Trigger => ({ match: 'exact', key: keyName, modifiers });
  const held = (...modifiers: string[]): Trigger => ({ match: 'held', modifiers });

  it.each([
    ['Ctrl+J and Alt+J both fire on Ctrl+Alt+J (native receipt)', subset('j', 'control'), subset('j', 'alt'), true],
    ['a Ctrl-only hotkey fires while Ctrl+Alt+J is pressed (native receipt)', held('control'), subset('j', 'control', 'alt'), true],
    ['a Ctrl+Alt+A hotkey and the Ctrl+Alt+A shortcut fire together (native receipt)', exact('a', 'control', 'alt'), subset('a', 'control', 'alt'), true],
    ['a hotkey with extra modifiers also fires the shortcut', exact('f5', 'control', 'shift'), subset('f5', 'shift'), true],
    ['Esc cancel fires inside a Ctrl+Esc hotkey', subset('escape'), exact('escape', 'control'), true],
    ['a hotkey with fewer modifiers never fires with the shortcut', exact('p', 'control'), subset('p', 'control', 'alt'), false],
    ['a Ctrl+Alt hotkey is never held for Ctrl+J', held('control', 'alt'), subset('j', 'control'), false],
    ['different keys never collide', subset('j', 'control'), subset('k', 'control'), false],
  ] as const)('%s', (_case, a, b, expected) => {
    expect(conflicts(a, b)).toBe(expected);
    expect(conflicts(b, a)).toBe(expected);
  });

  it('checks only the bindings a write changes, so an existing collision never blocks repairing another row', () => {
    const ctrl = settings({ hotkey: { kind: 'modifiers', keycodes: [X11 + 37], label: 'Ctrl' } });
    expect(shortcutsConflict(ctrl, new Set(['toggle-polish']), 'linux')).toBe(true);
    const repaired = { ...ctrl, sessionShortcuts: { ...ctrl.sessionShortcuts, 'toggle-polish': { key: 'p', modifiers: ['alt'] } } } as const;
    expect(shortcutsConflict(repaired, new Set(['toggle-polish']), 'linux')).toBe(false);
    expect(shortcutsConflict(repaired, new Set(['cycle-language']), 'linux')).toBe(true);
    expect(shortcutsConflict(repaired, new Set(), 'linux')).toBe(false);
  });

  it('checks the dictation hotkey against Esc, both shortcuts and each other', () => {
    expect(shortcutsConflict(settings({ hotkey: key(X11 + 30 + 8, ['control', 'alt']) }), HOTKEY, 'linux')).toBe(true);
    expect(shortcutsConflict(settings({ hotkey: key(EVDEV + 1, ['control']) }), HOTKEY, 'linux')).toBe(true);
    expect(shortcutsConflict(settings({ hotkey: { kind: 'modifiers', keycodes: [EVDEV + 56], label: 'Alt' } }), HOTKEY, 'linux')).toBe(true);
    expect(shortcutsConflict(settings({ hotkey: key(X11 + 96, ['control']) }), HOTKEY, 'linux')).toBe(false);
    expect(shortcutsConflict(settings({ hotkey: null }), HOTKEY, 'linux')).toBe(false);
  });
});
