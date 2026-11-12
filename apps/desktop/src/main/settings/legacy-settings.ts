import { isPlainRecord } from './settings-fields';

export type LegacyLanguage = 'sk' | 'cs' | 'en' | 'auto';

export interface LegacySettingsReader {
  legacyLanguage(): LegacyLanguage | null;
}

const LEGACY_LANGUAGES: readonly LegacyLanguage[] = ['sk', 'cs', 'en', 'auto'];

export function readLegacyLanguage(raw: unknown): LegacyLanguage | null {
  if (!isPlainRecord(raw)) {
    return null;
  }
  const stored = raw['language'];
  return LEGACY_LANGUAGES.find((language) => language === stored) ?? null;
}
