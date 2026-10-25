import { describe, expect, it } from 'vitest';
import { normalizeWord } from '../../src/dedup/normalize-word';
import { wordsMatch } from '../../src/dedup/words-match';

describe('normalizeWord', () => {
  it('drops case, diacritics and punctuation', () => {
    expect(normalizeWord('Zahodíme.')).toBe('zahodime');
    expect(normalizeWord('„Áno,"')).toBe('ano');
    expect(normalizeWord('-')).toBe('');
  });
});

describe('wordsMatch', () => {
  it('matches inflected forms regardless of case and punctuation', () => {
    expect(wordsMatch('zahodíme.', 'Zahodím')).toBe(true);
  });

  it('matches identical short words', () => {
    expect(wordsMatch('je', 'je')).toBe(true);
  });

  it('does not fuzzy-match short words', () => {
    expect(wordsMatch('a', 'v')).toBe(false);
    expect(wordsMatch('ten', 'tem')).toBe(false);
  });

  it('allows two edits only for words of 7 or more letters', () => {
    expect(wordsMatch('pokračujeme', 'pokračujem')).toBe(true);
    expect(wordsMatch('segment', 'fragment')).toBe(false);
    expect(wordsMatch('domov', 'domami')).toBe(false);
  });

  it('never matches punctuation-only tokens', () => {
    expect(wordsMatch('-', '-')).toBe(false);
  });
});
