import { describe, expect, it } from 'vitest';
import { removeBoundaryDuplicates, resolveBoundary } from '../../src/dedup/resolve-boundary';
import { splitLastWord } from '../../src/dedup/split-last-word';

describe('resolveBoundary with a carried word from a hard cut', () => {
  it('replaces a truncated carried word with the full word from the next segment', () => {
    expect(resolveBoundary('a potom', 'pokrač', 'potom pokračujeme ďalej', 7)).toBe('pokračujeme ďalej');
  });

  it('keeps the carried word when the next segment starts with a fragment of it', () => {
    expect(resolveBoundary('a potom to', 'zahodíme.', 'díme. Potom nový', 7)).toBe('zahodíme. Potom nový');
  });

  it('prepends the carried word when nothing overlaps', () => {
    expect(resolveBoundary('a potom', 'hotovo.', 'Nová veta.', 7)).toBe('hotovo. Nová veta.');
  });

  it('returns the carried word for an empty next segment', () => {
    expect(resolveBoundary('niečo', 'koniec', '', 7)).toBe('koniec');
  });

  it('keeps the next segment version and its punctuation after a truncated carried word', () => {
    expect(resolveBoundary('a potom', 'pokrač', 'potom pokračujeme , ďalej', 7)).toBe('pokračujeme , ďalej');
  });

  it('accepts a lowercase one-word fragment of the carried word', () => {
    expect(resolveBoundary('Nebolo to tak', 'doteraz', 'teraz je to iné', 7)).toBe('doteraz je to iné');
  });

  it('prefers the next segment version of an exactly matching carried word', () => {
    expect(resolveBoundary('jeden dva', 'tri', 'dva Tri, štyri', 7)).toBe('Tri, štyri');
  });
});

describe('removeBoundaryDuplicates fragments and truncation', () => {
  it('keeps a lone suffix-like first word after a pause cut', () => {
    expect(removeBoundaryDuplicates('potom to zahodíme.', 'díme. Potom nový', 4)).toBe('díme. Potom nový');
  });

  it('drops a fragment that starts a longer overlap', () => {
    expect(removeBoundaryDuplicates('jeden zahodíme potom ešte', 'díme potom ešte ďalej', 7)).toBe('ďalej');
  });

  it('removes a five-word overlap', () => {
    expect(removeBoundaryDuplicates('a teraz raz dva tri štyri päť', 'raz dva tri štyri päť šesť', 7)).toBe('šesť');
  });

  it('does not treat a prefix as truncation without a carried word', () => {
    expect(removeBoundaryDuplicates('ideme pred', 'predtým sme', 4)).toBe('predtým sme');
  });

  it('does not drop a fragment shorter than three letters', () => {
    expect(removeBoundaryDuplicates('zahodíme', 'me ďalej', 4)).toBe('me ďalej');
  });
});

describe('splitLastWord', () => {
  it('splits the last word with its trailing punctuation tokens', () => {
    expect(splitLastWord('a potom pokrač -')).toEqual({ head: 'a potom', tail: 'pokrač -' });
  });

  it('returns no tail for text without words', () => {
    expect(splitLastWord(' - ')).toEqual({ head: '-', tail: undefined });
    expect(splitLastWord('')).toEqual({ head: '', tail: undefined });
  });
});

const sentenceBoundaries: [previous: string, next: string][] = [
  ['Toto je riešenie.', 'Nie je iné.'],
  ['Bol tam stále.', 'Ale potom odišiel.'],
  ['Prišiel niekto?', 'Kto to bol?'],
  ['Máme stretnutie.', 'Tie veci počkajú.'],
  ['Nebolo to tak doteraz', 'Teraz je to iné'],
];

describe('capitalized first words in longer overlaps after a pause cut', () => {
  it.each([
    ['Robí to stále tak.', 'Ale tak to nie je.'],
    ['Bolo to stále to.', 'Ale to nevadí.'],
  ])('keeps the capitalized word: %s | %s', (previous, next) => {
    expect(removeBoundaryDuplicates(previous, next, 4)).toBe(next);
  });
});

describe('Slovak sentence boundaries keep their first word', () => {
  it.each(sentenceBoundaries)('after a pause cut: %s | %s', (previous, next) => {
    expect(removeBoundaryDuplicates(previous, next, 4)).toBe(next);
  });

  it.each(sentenceBoundaries)('after a hard cut with the last word carried: %s | %s', (previous, next) => {
    const { head, tail } = splitLastWord(previous);

    expect(resolveBoundary(head, tail, next, 7)).toBe(`${tail ?? ''} ${next}`);
  });

  it('keeps the first word of the carry path example', () => {
    expect(resolveBoundary('Toto je', 'riešenie.', 'Nie je to tak', 7)).toBe('riešenie. Nie je to tak');
  });
});
