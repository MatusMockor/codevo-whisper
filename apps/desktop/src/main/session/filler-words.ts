import type { DictationLanguage, LanguageSelection } from '../../shared/dictation-languages';

const HESITATIONS = ['ehm', 'eee', 'hmm'];

const FILLERS_BY_LANGUAGE: Readonly<Partial<Record<DictationLanguage, readonly string[]>>> = Object.freeze({
  sk: HESITATIONS,
  cs: HESITATIONS,
  en: ['um', 'uh', 'hmm'],
});

const AUTO_FILLERS: ReadonlySet<string> = new Set(['ehm', 'eee', 'hmm', 'um', 'uh']);

export function fillerWords(selection: LanguageSelection): ReadonlySet<string> {
  if (selection.mode === 'auto') {
    return AUTO_FILLERS;
  }
  const lists = selection.selected.flatMap((language) => {
    const list = FILLERS_BY_LANGUAGE[language];
    return list === undefined ? [] : [list];
  });
  if (lists.length < selection.selected.length) {
    return AUTO_FILLERS;
  }
  return new Set(lists.flat());
}
