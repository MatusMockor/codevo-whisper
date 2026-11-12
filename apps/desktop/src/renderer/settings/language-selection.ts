import { LANGUAGE_ORDER, MAX_SELECTED_LANGUAGES, type DictationLanguage } from '../../shared/dictation-languages';

export type LanguageEditError = 'limit' | 'last';

export type LanguageEdit = { ok: true; selected: readonly DictationLanguage[] } | { ok: false; error: LanguageEditError };

export type MoveDirection = 'up' | 'down';

export function toggleLanguage(selected: readonly DictationLanguage[], language: DictationLanguage): LanguageEdit {
  if (selected.includes(language)) {
    if (selected.length === 1) {
      return { ok: false, error: 'last' };
    }
    return { ok: true, selected: selected.filter((code) => code !== language) };
  }
  if (selected.length >= MAX_SELECTED_LANGUAGES) {
    return { ok: false, error: 'limit' };
  }
  return { ok: true, selected: [...selected, language] };
}

export function canMove(selected: readonly DictationLanguage[], language: DictationLanguage, direction: MoveDirection): boolean {
  const index = selected.indexOf(language);
  if (index < 0) {
    return false;
  }
  return direction === 'up' ? index > 0 : index < selected.length - 1;
}

export function moveLanguage(selected: readonly DictationLanguage[], language: DictationLanguage, direction: MoveDirection): readonly DictationLanguage[] {
  if (!canMove(selected, language, direction)) {
    return selected;
  }
  const index = selected.indexOf(language);
  const next = selected.filter((code) => code !== language);
  next.splice(direction === 'up' ? index - 1 : index + 1, 0, language);
  return next;
}

export function unselectedLanguages(selected: readonly DictationLanguage[]): readonly DictationLanguage[] {
  return LANGUAGE_ORDER.filter((language) => !selected.includes(language));
}
