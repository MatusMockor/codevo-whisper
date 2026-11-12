import type { DictationLanguage } from '@codevo-whisper/protocol';

export type { DictationLanguage };

export type LanguageMode = 'auto' | 'selected';

export type LanguageSelection = { readonly mode: LanguageMode; readonly selected: readonly DictationLanguage[] };

export const MAX_SELECTED_LANGUAGES = 5;

export const LANGUAGE_NAMES: Readonly<Record<DictationLanguage, string>> = Object.freeze({
  sk: 'Slovenčina',
  cs: 'Čeština',
  en: 'Angličtina',
  bg: 'Bulharčina',
  da: 'Dánčina',
  et: 'Estónčina',
  fi: 'Fínčina',
  fr: 'Francúzština',
  el: 'Gréčtina',
  nl: 'Holandčina',
  hr: 'Chorvátčina',
  lt: 'Litovčina',
  lv: 'Lotyština',
  hu: 'Maďarčina',
  mt: 'Maltčina',
  de: 'Nemčina',
  pl: 'Poľština',
  pt: 'Portugalčina',
  ro: 'Rumunčina',
  ru: 'Ruština',
  sl: 'Slovinčina',
  es: 'Španielčina',
  sv: 'Švédčina',
  it: 'Taliančina',
  uk: 'Ukrajinčina',
});

export const LANGUAGE_ORDER: readonly DictationLanguage[] = Object.freeze(Object.keys(LANGUAGE_NAMES) as DictationLanguage[]);

export function isDictationLanguage(value: unknown): value is DictationLanguage {
  return typeof value === 'string' && Object.hasOwn(LANGUAGE_NAMES, value);
}

export function primaryLanguage(selection: LanguageSelection): DictationLanguage | null {
  return selection.selected[0] ?? null;
}
