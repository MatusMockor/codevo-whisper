import { HOTKEY_KEYCODES, isEngineOrder, type Settings } from '../../shared/settings';

type FieldGuards = { readonly [K in keyof Settings]: (value: unknown) => value is Settings[K] };

const MAX_TEXT_LENGTH = 512;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_LENGTH;
}

function isNullableText(value: unknown): value is string | null {
  return value === null || isText(value);
}

function oneOf<T extends string>(allowed: readonly T[]): (value: unknown) => value is T {
  return (value: unknown): value is T => allowed.some((option) => option === value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isHotkey(value: unknown): value is Settings['hotkey'] {
  if (value === null) {
    return true;
  }
  if (!isPlainRecord(value) || !hasExactKeys(value, ['keycode', 'label'])) {
    return false;
  }
  return HOTKEY_KEYCODES.some((keycode) => keycode === value['keycode']) && isText(value['label']);
}

function isMicrophone(value: unknown): value is Settings['microphone'] {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['deviceId', 'label'])) {
    return false;
  }
  return isNullableText(value['deviceId']) && isNullableText(value['label']);
}

export const SETTINGS_FIELDS: FieldGuards = Object.freeze({
  hotkey: isHotkey,
  mode: oneOf(['hold', 'toggle']),
  language: oneOf(['sk', 'en', 'cs', 'auto']),
  microphone: isMicrophone,
  engineOrder: isEngineOrder,
  localModelId: isNullableText,
  insertion: oneOf(['paste', 'clipboard']),
  overlay: oneOf(['indicator', 'live']),
  launchAtLogin: isBoolean,
  onboardingDone: isBoolean,
});

export const SETTINGS_KEYS = Object.freeze(Object.keys(SETTINGS_FIELDS)) as ReadonlyArray<keyof Settings>;

export function isSettingsKey(key: string): key is keyof Settings {
  return Object.hasOwn(SETTINGS_FIELDS, key);
}

export function isValidField<K extends keyof Settings>(key: K, value: unknown): value is Settings[K] {
  return SETTINGS_FIELDS[key](value);
}
