import { isAiConfigured } from '../../shared/ai';
import type { HotkeySetting, Settings } from '../../shared/settings';
import type { OverlayAction } from '../../shared/overlay-contract';
import { conflicts, REBINDABLE_ACTIONS, SESSION_MODIFIERS, type RebindableAction, type RebindableKey, type SessionBinding, type SessionModifier, type Trigger } from '../../shared/session-shortcuts';

export type { SessionModifier };
export type SessionKey = RebindableKey | 'escape';
export type SessionShortcut = { action: OverlayAction; key: SessionKey; modifiers: readonly SessionModifier[] };
type Platform = NodeJS.Platform;

const FIXED_SESSION_SHORTCUTS: readonly SessionShortcut[] = Object.freeze([{ action: 'cancel', key: 'escape', modifiers: [] }]);

export const SESSION_KEYCODES: Readonly<Record<SessionKey, { darwin: number; linux: number }>> = Object.freeze({
  escape: { darwin: 53, linux: 1 },
  a: { darwin: 0, linux: 30 }, b: { darwin: 11, linux: 48 }, c: { darwin: 8, linux: 46 }, d: { darwin: 2, linux: 32 },
  e: { darwin: 14, linux: 18 }, f: { darwin: 3, linux: 33 }, g: { darwin: 5, linux: 34 }, h: { darwin: 4, linux: 35 },
  i: { darwin: 34, linux: 23 }, j: { darwin: 38, linux: 36 }, k: { darwin: 40, linux: 37 }, l: { darwin: 37, linux: 38 },
  m: { darwin: 46, linux: 50 }, n: { darwin: 45, linux: 49 }, o: { darwin: 31, linux: 24 }, p: { darwin: 35, linux: 25 },
  q: { darwin: 12, linux: 16 }, r: { darwin: 15, linux: 19 }, s: { darwin: 1, linux: 31 }, t: { darwin: 17, linux: 20 },
  u: { darwin: 32, linux: 22 }, v: { darwin: 9, linux: 47 }, w: { darwin: 13, linux: 17 }, x: { darwin: 7, linux: 45 },
  y: { darwin: 16, linux: 21 }, z: { darwin: 6, linux: 44 },
  0: { darwin: 29, linux: 11 }, 1: { darwin: 18, linux: 2 }, 2: { darwin: 19, linux: 3 }, 3: { darwin: 20, linux: 4 },
  4: { darwin: 21, linux: 5 }, 5: { darwin: 23, linux: 6 }, 6: { darwin: 22, linux: 7 }, 7: { darwin: 26, linux: 8 },
  8: { darwin: 28, linux: 9 }, 9: { darwin: 25, linux: 10 },
  f1: { darwin: 122, linux: 59 }, f2: { darwin: 120, linux: 60 }, f3: { darwin: 99, linux: 61 }, f4: { darwin: 118, linux: 62 },
  f5: { darwin: 96, linux: 63 }, f6: { darwin: 97, linux: 64 }, f7: { darwin: 98, linux: 65 }, f8: { darwin: 100, linux: 66 },
  f9: { darwin: 101, linux: 67 }, f10: { darwin: 109, linux: 68 }, f11: { darwin: 103, linux: 87 }, f12: { darwin: 111, linux: 88 },
});

const MODIFIER_KEYCODES: Readonly<Record<'darwin' | 'linux', Readonly<Record<number, SessionModifier>>>> = Object.freeze({
  darwin: { 54: 'meta', 55: 'meta', 56: 'shift', 60: 'shift', 58: 'alt', 61: 'alt', 59: 'control', 62: 'control' },
  linux: { 29: 'control', 97: 'control', 42: 'shift', 54: 'shift', 56: 'alt', 100: 'alt', 125: 'meta', 126: 'meta' },
});

const X11_TAG = 0x10000;
const EVDEV_TAG = 0x20000;
const X11_KEYCODE_OFFSET = 8;

function nativeKeycode(recorded: number, platform: Platform): number {
  if (platform === 'darwin') return recorded;
  if (recorded >= EVDEV_TAG) return recorded - EVDEV_TAG;
  return recorded - X11_TAG - X11_KEYCODE_OFFSET;
}

function sideOf(platform: Platform): 'darwin' | 'linux' {
  return platform === 'darwin' ? 'darwin' : 'linux';
}

function sessionKeyOf(recorded: number, platform: Platform): SessionKey | null {
  const code = nativeKeycode(recorded, platform);
  const side = sideOf(platform);
  const entry = Object.entries(SESSION_KEYCODES).find(([, codes]) => codes[side] === code);
  return entry === undefined ? null : (entry[0] as SessionKey);
}

function isSessionModifier(modifier: string): modifier is SessionModifier {
  return SESSION_MODIFIERS.some((candidate) => candidate === modifier);
}

function hotkeyTrigger(hotkey: HotkeySetting, platform: Platform): Trigger | null {
  if (hotkey === null) return null;
  if (hotkey.kind === 'modifiers') {
    const names = MODIFIER_KEYCODES[sideOf(platform)];
    return { match: 'held', modifiers: hotkey.keycodes.map((code) => names[nativeKeycode(code, platform)] ?? `keycode-${code}`) };
  }
  const key = sessionKeyOf(hotkey.keycode, platform);
  return key === null ? null : { match: 'exact', key, modifiers: hotkey.modifiers };
}

function shortcutTrigger({ key, modifiers }: { key: SessionKey; modifiers: readonly SessionModifier[] }): Trigger {
  return { match: 'subset', key, modifiers };
}

function firesWithHotkey(row: SessionShortcut, hotkey: Trigger | null): boolean {
  return hotkey !== null && conflicts(shortcutTrigger(row), hotkey);
}

export type ShortcutSlot = 'hotkey' | RebindableAction;

export function shortcutsConflict(settings: Pick<Settings, 'hotkey' | 'sessionShortcuts'>, changed: ReadonlySet<ShortcutSlot>, platform: Platform = process.platform): boolean {
  const hotkey = hotkeyTrigger(settings.hotkey, platform);
  const slots: Array<{ slot: ShortcutSlot | null; trigger: Trigger }> = [
    ...(hotkey === null ? [] : [{ slot: 'hotkey' as const, trigger: hotkey }]),
    ...FIXED_SESSION_SHORTCUTS.map((row) => ({ slot: null, trigger: shortcutTrigger(row) })),
    ...REBINDABLE_ACTIONS.map((action) => ({ slot: action, trigger: shortcutTrigger(settings.sessionShortcuts[action]) })),
  ];
  const touched = (slot: ShortcutSlot | null) => slot !== null && changed.has(slot);
  return slots.some((a, index) => slots.slice(index + 1).some((b) => (touched(a.slot) || touched(b.slot)) && conflicts(a.trigger, b.trigger)));
}

export function recordedSessionBinding(recorded: NonNullable<HotkeySetting>, platform: Platform): SessionBinding | null {
  if (recorded.kind !== 'key') return null;
  const key = sessionKeyOf(recorded.keycode, platform);
  const modifiers = recorded.modifiers.filter(isSessionModifier);
  if (key === null || key === 'escape' || modifiers.length !== recorded.modifiers.length) return null;
  return { key, modifiers };
}

export function armedSessionShortcuts(settings: Settings, platform: Platform): readonly SessionShortcut[] {
  const rebindable = REBINDABLE_ACTIONS.filter((action) => action !== 'toggle-polish' || isAiConfigured(settings)).map((action) => ({ action, ...settings.sessionShortcuts[action] }));
  const hotkey = hotkeyTrigger(settings.hotkey, platform);
  return [...FIXED_SESSION_SHORTCUTS, ...rebindable].filter((row) => !firesWithHotkey(row, hotkey));
}
