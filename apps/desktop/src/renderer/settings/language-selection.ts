import { LANGUAGE_NAMES, LANGUAGE_ORDER, MAX_SELECTED_LANGUAGES, type DictationLanguage, type LanguageSelection } from '../../shared/dictation-languages';
import { matchesTerms, searchTerms } from '../search/text-match';

export type LanguageEditError = 'limit' | 'last';

export type LanguageEdit = { ok: true; selected: readonly DictationLanguage[] } | { ok: false; error: LanguageEditError };

export type ShiftDirection = 'up' | 'down';

export function moveLanguage(selected: readonly DictationLanguage[], language: DictationLanguage, to: number): readonly DictationLanguage[] {
  const from = selected.indexOf(language);
  if (from < 0) {
    return selected;
  }
  const next = selected.filter((code) => code !== language);
  const target = Math.min(Math.max(to > from ? to - 1 : to, 0), next.length);
  next.splice(target, 0, language);
  return next;
}

export function shiftLanguage(selected: readonly DictationLanguage[], language: DictationLanguage, direction: ShiftDirection): readonly DictationLanguage[] {
  const index = selected.indexOf(language);
  if (index < 0) {
    return selected;
  }
  return moveLanguage(selected, language, direction === 'up' ? index - 1 : index + 2);
}

export function addLanguage(selected: readonly DictationLanguage[], language: DictationLanguage, at: number = selected.length): LanguageEdit {
  if (selected.includes(language)) {
    return { ok: true, selected: moveLanguage(selected, language, at) };
  }
  if (selected.length >= MAX_SELECTED_LANGUAGES) {
    return { ok: false, error: 'limit' };
  }
  const next = [...selected];
  next.splice(Math.min(Math.max(at, 0), next.length), 0, language);
  return { ok: true, selected: next };
}

export function removeLanguage(selected: readonly DictationLanguage[], language: DictationLanguage): LanguageEdit {
  if (!selected.includes(language)) {
    return { ok: true, selected };
  }
  if (selected.length === 1) {
    return { ok: false, error: 'last' };
  }
  return { ok: true, selected: selected.filter((code) => code !== language) };
}

export function availableLanguages(selected: readonly DictationLanguage[], query: string): readonly DictationLanguage[] {
  const terms = searchTerms(query);
  return LANGUAGE_ORDER.filter((language) => !selected.includes(language) && matchesTerms(`${LANGUAGE_NAMES[language]} ${language}`, terms));
}

export type PendingSelection = { readonly value: LanguageSelection; readonly saves: number } | null;

export function effectiveSelection(pending: PendingSelection, stored: LanguageSelection): LanguageSelection {
  return pending?.value ?? stored;
}

export function beginSave(pending: PendingSelection, value: LanguageSelection): PendingSelection {
  return { value, saves: (pending?.saves ?? 0) + 1 };
}

export function settleSave(pending: PendingSelection, saved: boolean): PendingSelection {
  if (pending === null || !saved || pending.saves <= 1) {
    return null;
  }
  return { value: pending.value, saves: pending.saves - 1 };
}
