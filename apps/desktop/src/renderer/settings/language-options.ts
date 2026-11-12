import { LANGUAGE_NAMES, type DictationLanguage, type LanguageMode } from '../../shared/dictation-languages';
import type { LanguageHint, ModelInfo } from '../../shared/models';
import type { Settings } from '../../shared/settings';
import type { LanguageEditError } from './language-selection';
import type { ModelAction } from './model-rows';

export type LanguageModeOption = { id: LanguageMode; label: string; disabled?: boolean };

export const LANGUAGE_MODE_DESCRIPTIONS: Readonly<Record<LanguageMode, string>> = Object.freeze({
  auto: 'Jazyk rozpozná model sám. Je to najrýchlejšie, pri krátkych vetách sa však môže pomýliť, napríklad napísať slovenčinu po česky.',
  selected: 'Prepíše sa len v jazykoch, ktoré používate. Prvý jazyk je hlavný. Keď si aplikácia nie je istá jazykom, ponechá text tak, ako zaznel, a nič neprekladá.',
});

export const LANGUAGE_EDIT_ERRORS: Readonly<Record<LanguageEditError, string>> = Object.freeze({
  limit: 'Používať môžete najviac 5 jazykov. Najprv niektorý odoberte.',
  last: 'Aspoň jeden jazyk musí zostať.',
});

export const SINGLE_LANGUAGE_HINT = 'Reč v príbuznom jazyku, napríklad v češtine, sa prepíše v zvolenom jazyku. Ak hovoríte aj ňou, pridajte ju.';

export const MEETINGS_LANGUAGE_NOTE = 'Výber jazykov platí pre diktovanie. Stretnutia sa prepisujú s automatickým rozpoznaním jazyka, okrem modelu Whisper s jedným zvoleným jazykom.';

export const NO_MATCHING_LANGUAGE = 'Žiadny jazyk nezodpovedá hľadaniu.';

export type LanguageChange = 'added' | 'removed';

const CHANGE_WORDS: Readonly<Record<LanguageChange, string>> = Object.freeze({ added: 'pridaná', removed: 'odobraná' });

export function languageChangeNotice(language: DictationLanguage, change: LanguageChange): string {
  return `${LANGUAGE_NAMES[language]} ${CHANGE_WORDS[change]}.`;
}

export function languageRowLabel(language: DictationLanguage, index: number): string {
  const primary = index === 0 ? ', hlavný jazyk' : '';
  return `${LANGUAGE_NAMES[language]}${primary}, poradie ${index + 1}`;
}

export function requiresLanguage(hint: LanguageHint | null | undefined): boolean {
  return hint === 'required';
}

export function languageModeOptions(hint: LanguageHint | null): readonly LanguageModeOption[] {
  return [
    { id: 'auto', label: 'Automaticky', disabled: requiresLanguage(hint) },
    { id: 'selected', label: 'Zvolené jazyky' },
  ];
}

export function requiredLanguageNote(model: ModelInfo | null): string | null {
  if (model === null || !requiresLanguage(model.languageHint)) {
    return null;
  }
  return `Model ${model.name} potrebuje zvolené jazyky, automatické rozpoznanie s ním nie je dostupné.`;
}

const ACTIVATING_ACTIONS: ReadonlySet<ModelAction> = new Set(['download', 'continue']);

export function needsLanguageChoice(model: ModelInfo, action: ModelAction, settings: Pick<Settings, 'languages' | 'localModelId'>): boolean {
  if (!requiresLanguage(model.languageHint) || settings.languages.mode !== 'auto') {
    return false;
  }
  if (action === 'activate') {
    return true;
  }
  return ACTIVATING_ACTIONS.has(action) && settings.localModelId === null;
}
