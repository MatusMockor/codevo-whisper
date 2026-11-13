export const SESSION_MODIFIERS = ['control', 'alt', 'shift', 'meta'] as const;
export type SessionModifier = (typeof SESSION_MODIFIERS)[number];

export const REBINDABLE_KEYS = [
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
] as const;
export type RebindableKey = (typeof REBINDABLE_KEYS)[number];

export type SessionBinding = { key: RebindableKey; modifiers: readonly SessionModifier[] };

export const REBINDABLE_ACTIONS = ['toggle-polish', 'cycle-language'] as const;
export type RebindableAction = (typeof REBINDABLE_ACTIONS)[number];

export type SessionShortcutSettings = Readonly<Record<RebindableAction, SessionBinding>>;

export const DEFAULT_SESSION_SHORTCUTS: SessionShortcutSettings = Object.freeze({
  'toggle-polish': Object.freeze({ key: 'a', modifiers: Object.freeze(['control', 'alt'] as const) }),
  'cycle-language': Object.freeze({ key: 'j', modifiers: Object.freeze(['control', 'alt'] as const) }),
});

type Chord = { key: string; modifiers: readonly string[] };

function within(inner: readonly string[], outer: readonly string[]): boolean {
  return inner.every((modifier) => outer.includes(modifier));
}

export function overlaps(a: Chord, b: Chord): boolean {
  return a.key === b.key && (within(a.modifiers, b.modifiers) || within(b.modifiers, a.modifiers));
}

const MAC_SYMBOLS: Readonly<Record<SessionModifier, string>> = { control: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' };
const PC_NAMES: Readonly<Record<SessionModifier, string>> = { control: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Super' };

export function sessionShortcutLabel(binding: SessionBinding, mac: boolean): string {
  const modifiers = SESSION_MODIFIERS.filter((modifier) => binding.modifiers.includes(modifier));
  const key = binding.key.toUpperCase();
  return mac ? `${modifiers.map((modifier) => MAC_SYMBOLS[modifier]).join('')}${key}` : [...modifiers.map((modifier) => PC_NAMES[modifier]), key].join('+');
}
