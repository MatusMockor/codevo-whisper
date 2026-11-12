import { CODEX_EFFORTS, isAiBaseUrl, isAiModel, isCodexModel } from '../../shared/ai';
import { isDictationLanguage, MAX_SELECTED_LANGUAGES } from '../../shared/dictation-languages';
import { parseHotkeySetting } from '../../shared/hotkey';
import { isCustomWords, isEngineOrder, type Settings } from '../../shared/settings';

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

function oneOf<T extends string | number>(allowed: readonly T[]): (value: unknown) => value is T {
  return (value: unknown): value is T => allowed.some((option) => option === value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isHotkey(value: unknown): value is Settings['hotkey'] {
  return value === null || parseHotkeySetting(value) !== undefined;
}

function isMicrophone(value: unknown): value is Settings['microphone'] {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['deviceId', 'label'])) {
    return false;
  }
  return isNullableText(value['deviceId']) && isNullableText(value['label']);
}

function isSelectedLanguages(value: unknown): value is Settings['languages']['selected'] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SELECTED_LANGUAGES) {
    return false;
  }
  return value.every(isDictationLanguage) && new Set(value).size === value.length;
}

function isLanguages(value: unknown): value is Settings['languages'] {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['mode', 'selected'])) {
    return false;
  }
  return oneOf(['auto', 'selected'])(value['mode']) && isSelectedLanguages(value['selected']);
}

export const SETTINGS_FIELDS: FieldGuards = Object.freeze({
  muteWhileRecording: isBoolean,
  audioFeedback: isBoolean,
  feedbackOutputId: isNullableText,
  feedbackVolume: (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100,
  customWords: isCustomWords,
  removeFillerWords: isBoolean,
  appendTrailingSpace: isBoolean,
  hotkey: isHotkey,
  mode: oneOf(['hold', 'toggle', 'smart']),
  languages: isLanguages,
  microphone: isMicrophone,
  engineOrder: isEngineOrder,
  serverEnabled: isBoolean,
  serverRestoreOrder: (value: unknown): value is Settings['serverRestoreOrder'] => value === null || isEngineOrder(value),
  localModelId: isNullableText,
  localAcceleration: oneOf(['auto', 'gpu', 'cpu']),
  localModelUnload: oneOf(['never', 'immediately', 2, 5, 10, 15, 60]),
  insertion: oneOf(['paste', 'type', 'clipboard']),
  clipboardPolicy: oneOf(['restore', 'leave']),
  autoSubmit: oneOf(['off', 'enter', 'primary-enter']),
  linuxPasteShortcut: oneOf(['ctrl-v', 'ctrl-shift-v', 'shift-insert']),
  overlay: oneOf(['indicator', 'live']),
  launchAtLogin: isBoolean,
  onboardingDone: isBoolean,
  aiBaseUrl: (value: unknown): value is string | null => value === null || isAiBaseUrl(value),
  aiModel: isAiModel,
  aiPolish: isBoolean,
  aiProvider: oneOf(['server', 'codex']),
  codexModel: isCodexModel,
  codexEffort: oneOf(CODEX_EFFORTS),
});

export const SETTINGS_KEYS = Object.freeze(Object.keys(SETTINGS_FIELDS)) as ReadonlyArray<keyof Settings>;

export function isSettingsKey(key: string): key is keyof Settings {
  return Object.hasOwn(SETTINGS_FIELDS, key);
}

export function isValidField<K extends keyof Settings>(key: K, value: unknown): value is Settings[K] {
  return SETTINGS_FIELDS[key](value);
}
