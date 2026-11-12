import { describe, expect, it } from 'vitest';
import { canMove, moveLanguage, toggleLanguage, unselectedLanguages } from '../src/renderer/settings/language-selection';
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

describe('toggleLanguage', () => {
  it('appends a checked language after the others and removes an unchecked one', () => {
    expect(toggleLanguage(['sk'], 'cs')).toEqual({ ok: true, selected: ['sk', 'cs'] });
    expect(toggleLanguage(['sk', 'cs', 'en'], 'cs')).toEqual({ ok: true, selected: ['sk', 'en'] });
    expect(toggleLanguage(['sk', 'cs'], 'sk')).toEqual({ ok: true, selected: ['cs'] });
  });

  it('keeps at most five languages and at least one', () => {
    expect(toggleLanguage(['sk', 'cs', 'en', 'de', 'pl'], 'hu')).toEqual({ ok: false, error: 'limit' });
    expect(toggleLanguage(['sk', 'cs', 'en', 'de', 'pl'], 'pl')).toEqual({ ok: true, selected: ['sk', 'cs', 'en', 'de'] });
    expect(toggleLanguage(['cs'], 'cs')).toEqual({ ok: false, error: 'last' });
  });
});

describe('moveLanguage', () => {
  it('moves a language one step up or down and makes it primary at the top', () => {
    expect(moveLanguage(['sk', 'cs', 'en'], 'cs', 'up')).toEqual(['cs', 'sk', 'en']);
    expect(moveLanguage(['sk', 'cs', 'en'], 'cs', 'down')).toEqual(['sk', 'en', 'cs']);
    expect(moveLanguage(['sk', 'cs', 'en'], 'sk', 'down')).toEqual(['cs', 'sk', 'en']);
  });

  it('leaves the order alone at the edges and for an unselected language', () => {
    expect(canMove(['sk', 'cs'], 'sk', 'up')).toBe(false);
    expect(canMove(['sk', 'cs'], 'cs', 'down')).toBe(false);
    expect(canMove(['sk', 'cs'], 'en', 'up')).toBe(false);
    expect(moveLanguage(['sk', 'cs'], 'sk', 'up')).toEqual(['sk', 'cs']);
    expect(moveLanguage(['sk', 'cs'], 'cs', 'down')).toEqual(['sk', 'cs']);
    expect(moveLanguage(['sk', 'cs'], 'en', 'up')).toEqual(['sk', 'cs']);
  });
});

describe('unselectedLanguages', () => {
  it('lists the other languages in the catalog order', () => {
    const rest = unselectedLanguages(['en', 'sk']);

    expect(rest.slice(0, 3)).toEqual(['cs', 'bg', 'da']);
    expect(rest).toHaveLength(23);
  });
});
