import { DICTATION_LANGUAGES, MAX_DICTATION_LANGUAGES, type DictationLanguage } from '@codevo-whisper/protocol';

export const SUPPORTED_LANGUAGES = DICTATION_LANGUAGES;

export const MAX_SELECTED_LANGUAGES = MAX_DICTATION_LANGUAGES;

export type SupportedLanguage = DictationLanguage;

export type LanguageScore = { code: SupportedLanguage; p: number };

const SUPPORTED: ReadonlySet<string> = new Set(SUPPORTED_LANGUAGES);

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return SUPPORTED.has(value);
}
