import type { LanguageSelection } from '../../shared/dictation-languages';
import type { LanguageHint } from '../../shared/models';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings';
import type { LegacyLanguage, LegacySettingsReader } from './legacy-settings';

export type LanguageMigrationDeps = {
  legacy: LegacySettingsReader;
  settings: { update(patch: Partial<Settings>): Promise<Settings> };
  activeLanguageHint: () => LanguageHint | null;
};

export function migratedLanguages(legacy: LegacyLanguage, hint: LanguageHint | null): LanguageSelection {
  if (legacy === 'auto') {
    return DEFAULT_SETTINGS.languages;
  }
  if (hint === 'required') {
    return { mode: 'selected', selected: [legacy] };
  }
  return { mode: 'auto', selected: [legacy] };
}

export async function migrateLegacyLanguage({ legacy, settings, activeLanguageHint }: LanguageMigrationDeps): Promise<boolean> {
  const language = legacy.legacyLanguage();
  if (language === null) {
    return false;
  }
  await settings.update({ languages: migratedLanguages(language, activeLanguageHint()) });
  return true;
}
