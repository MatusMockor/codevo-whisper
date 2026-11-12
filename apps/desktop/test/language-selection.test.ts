import { describe, expect, it } from 'vitest';
import { addLanguage, availableLanguages, beginSave, effectiveSelection, moveLanguage, removeLanguage, settleSave, shiftLanguage } from '../src/renderer/settings/language-selection';
import { DICTATION_LANGUAGES } from '@codevo-whisper/protocol';
import { LANGUAGE_NAMES, LANGUAGE_ORDER } from '../src/shared/dictation-languages';

describe('dictation language catalog', () => {
  it('offers exactly the protocol languages, Slovak, Czech and English first, then by Slovak name', () => {
    expect([...LANGUAGE_ORDER].sort()).toEqual([...DICTATION_LANGUAGES].sort());
    expect(LANGUAGE_ORDER.map((code) => LANGUAGE_NAMES[code])).toEqual([
      'Slovenčina', 'Čeština', 'Angličtina',
      'Bulharčina', 'Dánčina', 'Estónčina', 'Fínčina', 'Francúzština', 'Gréčtina', 'Holandčina', 'Chorvátčina', 'Litovčina', 'Lotyština', 'Maďarčina',
      'Maltčina', 'Nemčina', 'Poľština', 'Portugalčina', 'Rumunčina', 'Ruština', 'Slovinčina', 'Španielčina', 'Švédčina', 'Taliančina', 'Ukrajinčina',
    ]);
  });
});

describe('addLanguage', () => {
  it('appends by default and inserts at the dropped position', () => {
    expect(addLanguage(['sk'], 'cs')).toEqual({ ok: true, selected: ['sk', 'cs'] });
    expect(addLanguage(['sk', 'cs'], 'en', 0)).toEqual({ ok: true, selected: ['en', 'sk', 'cs'] });
    expect(addLanguage(['sk', 'cs'], 'en', 1)).toEqual({ ok: true, selected: ['sk', 'en', 'cs'] });
    expect(addLanguage(['sk', 'cs'], 'en', 9)).toEqual({ ok: true, selected: ['sk', 'cs', 'en'] });
  });

  it('keeps at most five languages and moves one that is already used', () => {
    expect(addLanguage(['sk', 'cs', 'en', 'de', 'pl'], 'hu')).toEqual({ ok: false, error: 'limit' });
    expect(addLanguage(['sk', 'cs', 'en', 'de', 'pl'], 'pl', 0)).toEqual({ ok: true, selected: ['pl', 'sk', 'cs', 'en', 'de'] });
  });
});

describe('removeLanguage', () => {
  it('removes a used language and keeps the last one', () => {
    expect(removeLanguage(['sk', 'cs', 'en'], 'cs')).toEqual({ ok: true, selected: ['sk', 'en'] });
    expect(removeLanguage(['sk', 'cs'], 'sk')).toEqual({ ok: true, selected: ['cs'] });
    expect(removeLanguage(['cs'], 'cs')).toEqual({ ok: false, error: 'last' });
    expect(removeLanguage(['cs'], 'sk')).toEqual({ ok: true, selected: ['cs'] });
  });
});

describe('moveLanguage', () => {
  it('moves a row to the insertion point between the other rows', () => {
    expect(moveLanguage(['sk', 'cs', 'en'], 'en', 0)).toEqual(['en', 'sk', 'cs']);
    expect(moveLanguage(['sk', 'cs', 'en'], 'sk', 2)).toEqual(['cs', 'sk', 'en']);
    expect(moveLanguage(['sk', 'cs', 'en'], 'sk', 3)).toEqual(['cs', 'en', 'sk']);
    expect(moveLanguage(['sk', 'cs', 'en'], 'cs', 1)).toEqual(['sk', 'cs', 'en']);
    expect(moveLanguage(['sk', 'cs', 'en'], 'cs', 2)).toEqual(['sk', 'cs', 'en']);
    expect(moveLanguage(['sk', 'cs'], 'en', 0)).toEqual(['sk', 'cs']);
  });
});

describe('shiftLanguage', () => {
  it('moves a row one step up or down and stays put at the edges', () => {
    expect(shiftLanguage(['sk', 'cs', 'en'], 'cs', 'up')).toEqual(['cs', 'sk', 'en']);
    expect(shiftLanguage(['sk', 'cs', 'en'], 'cs', 'down')).toEqual(['sk', 'en', 'cs']);
    expect(shiftLanguage(['sk', 'cs', 'en'], 'sk', 'up')).toEqual(['sk', 'cs', 'en']);
    expect(shiftLanguage(['sk', 'cs', 'en'], 'en', 'down')).toEqual(['sk', 'cs', 'en']);
    expect(shiftLanguage(['sk', 'cs'], 'en', 'up')).toEqual(['sk', 'cs']);
  });
});

describe('availableLanguages', () => {
  it('lists the other languages in the catalog order', () => {
    const rest = availableLanguages(['en', 'sk'], '');

    expect(rest.slice(0, 3)).toEqual(['cs', 'bg', 'da']);
    expect(rest).toHaveLength(23);
  });

  it('matches the name or the code, ignoring case and diacritics', () => {
    expect(availableLanguages(['sk'], 'cest')).toEqual(['cs']);
    expect(availableLanguages(['sk'], ' DE ')).toEqual(['de']);
    expect(availableLanguages(['sk'], 'slov')).toEqual(['sl']);
    expect(availableLanguages(['sk'], 'klingončina')).toEqual([]);
  });
});

describe('pending selection', () => {
  const stored = { mode: 'selected', selected: ['sk'] } as const;

  it('shows the latest edit until every save settles', () => {
    const first = beginSave(null, { mode: 'selected', selected: ['sk', 'cs'] });
    const second = beginSave(first, { mode: 'selected', selected: ['sk', 'cs', 'en'] });

    expect(effectiveSelection(second, stored)).toEqual({ mode: 'selected', selected: ['sk', 'cs', 'en'] });
    expect(effectiveSelection(settleSave(second, true), stored)).toEqual({ mode: 'selected', selected: ['sk', 'cs', 'en'] });
    expect(settleSave(settleSave(second, true), true)).toBeNull();
    expect(effectiveSelection(null, stored)).toEqual(stored);
  });

  it('switches the mode on top of a language edit that is still saving', () => {
    const editing = beginSave(null, { mode: 'selected', selected: ['sk', 'cs'] });
    const effective = effectiveSelection(editing, stored);

    const switched = beginSave(editing, { ...effective, mode: 'auto' });

    expect(effectiveSelection(switched, stored)).toEqual({ mode: 'auto', selected: ['sk', 'cs'] });
  });

  it('falls back to the stored selection when a save fails', () => {
    const editing = beginSave(beginSave(null, { mode: 'auto', selected: ['sk'] }), { mode: 'selected', selected: ['cs'] });

    expect(settleSave(editing, false)).toBeNull();
    expect(settleSave(null, true)).toBeNull();
  });
});
