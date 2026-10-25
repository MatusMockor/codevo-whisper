import type { LanguageHint, ModelInfo } from '../../shared/models';
import type { Language, Settings } from '../../shared/settings';
import type { ModelAction } from './model-rows';

export type LanguageOption = { id: Language; label: string; disabled: boolean };

const LANGUAGES: ReadonlyArray<{ id: Language; label: string }> = [
  { id: 'sk', label: 'Slovenčina' },
  { id: 'cs', label: 'Čeština' },
  { id: 'en', label: 'Angličtina' },
  { id: 'auto', label: 'Automaticky' },
];

export const AUTO_LANGUAGE_NOTE = 'Automatické rozpoznanie pridá k prvému slovu asi 0,1 s.';

export function requiresLanguage(hint: LanguageHint | null | undefined): boolean {
  return hint === 'required';
}

export function languageOptions(hint: LanguageHint | null): LanguageOption[] {
  return LANGUAGES.map((language) => ({ ...language, disabled: language.id === 'auto' && requiresLanguage(hint) }));
}

export function languageNote(model: ModelInfo | null): string {
  if (model === null || !requiresLanguage(model.languageHint)) {
    return AUTO_LANGUAGE_NOTE;
  }
  return `Model ${model.name} potrebuje vedieť jazyk, automatické rozpoznanie s ním nie je dostupné.`;
}

const ACTIVATING_ACTIONS: ReadonlySet<ModelAction> = new Set(['download', 'continue']);

export function needsLanguageChoice(model: ModelInfo, action: ModelAction, settings: Pick<Settings, 'language' | 'localModelId'>): boolean {
  if (!requiresLanguage(model.languageHint) || settings.language !== 'auto') {
    return false;
  }
  if (action === 'activate') {
    return true;
  }
  return ACTIVATING_ACTIONS.has(action) && settings.localModelId === null;
}
