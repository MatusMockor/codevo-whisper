import type { HotkeySetting } from './settings';

export const MODIFIERS = ['control', 'alt', 'shift', 'meta', 'fn'] as const;
export type Modifier = (typeof MODIFIERS)[number];
export type Members<T> = readonly [T, ...T[]];
export type HotkeyBinding =
  | { kind: 'modifiers'; keycodes: Members<number> }
  | { kind: 'key'; keycode: number; modifiers: Members<Modifier> };
export type HotkeyEvent = { phase: 'down' | 'up'; ts: number };

function isKeycode(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isModifier(value: unknown): value is Modifier {
  return MODIFIERS.some((modifier) => modifier === value);
}

function members<T>(value: unknown, valid: (member: unknown) => member is T, compare: (a: T, b: T) => number): Members<T> | undefined {
  if (!Array.isArray(value) || !value.every(valid) || new Set(value).size !== value.length) {
    return undefined;
  }
  const [first, ...rest] = value.toSorted(compare);
  return first === undefined ? undefined : Object.freeze([first, ...rest]);
}

export function parseHotkeySetting(value: unknown): NonNullable<HotkeySetting> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return undefined;
  }
  if (!('label' in value) || typeof value.label !== 'string' || value.label.length === 0 || value.label.length > 512 || !('kind' in value)) {
    return undefined;
  }
  if (value.kind === 'modifiers' && 'keycodes' in value && Object.keys(value).length === 3) {
    const keycodes = members(value.keycodes, isKeycode, (a, b) => a - b);
    return keycodes && Object.freeze({ kind: 'modifiers', keycodes, label: value.label });
  }
  if (value.kind === 'key' && 'keycode' in value && 'modifiers' in value && Object.keys(value).length === 4 && isKeycode(value.keycode)) {
    const modifiers = members(value.modifiers, isModifier, (a, b) => MODIFIERS.indexOf(a) - MODIFIERS.indexOf(b));
    return modifiers && Object.freeze({ kind: 'key', keycode: value.keycode, modifiers, label: value.label });
  }
  return undefined;
}

export function sameHotkey(a: HotkeySetting, b: HotkeySetting): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (a.kind === 'modifiers' && b.kind === 'modifiers') {
    return a.keycodes.length === b.keycodes.length && a.keycodes.every((key, index) => key === b.keycodes[index]);
  }
  return a.kind === 'key' && b.kind === 'key' && a.keycode === b.keycode && a.modifiers.length === b.modifiers.length && a.modifiers.every((modifier, index) => modifier === b.modifiers[index]);
}
