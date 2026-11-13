import { upgradeLegacyCustomWords } from '../../shared/custom-words';
import { parseHotkeySetting } from '../../shared/hotkey';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings';
import { isReservedHotkey } from './hotkey-policy';
import { isMicrophone, isPlainRecord, isValidField, SETTINGS_KEYS } from './settings-fields';

function pickField<K extends keyof Settings>(source: Record<string, unknown>, key: K): Settings[K] {
  const value = source[key];
  if (isValidField(key, value)) {
    return value;
  }
  return DEFAULT_SETTINGS[key];
}

function storedHotkey(value: unknown): Settings['hotkey'] | undefined {
  if (value === null) return null;
  if (isPlainRecord(value) && Object.keys(value).length === 2 && [54, 58, 61, 62, 63].some((code) => code === value['keycode'])) {
    return parseHotkeySetting({ kind: 'modifiers', keycodes: [value['keycode']], label: value['label'] });
  }
  const parsed = parseHotkeySetting(value);
  return parsed && !isReservedHotkey(parsed) ? parsed : undefined;
}

function storedMicrophones(source: Record<string, unknown>): unknown {
  if (isValidField('microphones', source['microphones'])) {
    return source['microphones'];
  }
  const legacy = source['microphone'];
  return isMicrophone(legacy) ? [legacy] : undefined;
}

export function sanitizeSettings(raw: unknown): Settings {
  const source = isPlainRecord(raw) ? { ...raw } : {};
  source['hotkey'] = storedHotkey(source['hotkey']);
  source['customWords'] = upgradeLegacyCustomWords(source['customWords']);
  source['microphones'] = storedMicrophones(source);
  return Object.fromEntries(SETTINGS_KEYS.map((key) => [key, pickField(source, key)])) as Settings;
}
