import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings';
import { isPlainRecord, isValidField, SETTINGS_KEYS } from './settings-fields';

function pickField<K extends keyof Settings>(source: Record<string, unknown>, key: K): Settings[K] {
  const value = source[key];
  if (isValidField(key, value)) {
    return value;
  }
  return DEFAULT_SETTINGS[key];
}

export function sanitizeSettings(raw: unknown): Settings {
  const source = isPlainRecord(raw) ? raw : {};
  return Object.fromEntries(SETTINGS_KEYS.map((key) => [key, pickField(source, key)])) as Settings;
}
