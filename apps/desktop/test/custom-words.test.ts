import { describe, expect, it } from 'vitest';
import { formatCustomWords, isCustomWords, parseCustomWords, preferredSpellings, upgradeLegacyCustomWords, type CustomWord } from '../src/shared/custom-words';

function entry(word: string, ...aliases: string[]): CustomWord {
  return { word, aliases };
}

describe('isCustomWords', () => {
  it('accepts preferred spellings with aliases, multi-word terms and the limits', () => {
    expect(isCustomWords([])).toBe(true);
    expect(isCustomWords([entry('Žilina'), entry('GPT-4'), entry("O’Reilly"), entry('Node.js'), entry('Kumiba MCP', 'kumiba em si pí', 'kumba MCP')])).toBe(true);
    expect(isCustomWords([entry('a'.repeat(64), ...Array.from({ length: 10 }, (_, index) => `alias${index}`))])).toBe(true);
    expect(isCustomWords(Array.from({ length: 100 }, (_, index) => entry(`word${index}`)))).toBe(true);
  });

  it('rejects malformed entries, terms and lists over the limits', () => {
    const invalid: unknown[] = [
      null, 'word', ['Kumiba'], [7], [{ word: 'Kumiba' }], [{ word: 'Kumiba', aliases: 'kumba' }], [{ word: 'Kumiba', aliases: [], extra: true }],
      [entry('')], [entry('two  spaces')], [entry(' leading')], [entry('trailing ')], [entry('a\u0000b')], [entry('a/b')], [entry('a@b')],
      [entry('a'.repeat(65))], [entry('ž'.repeat(64) + 'ž')], [entry('Žilina')], [entry('Kumiba', 'a/b')], [entry('Kumiba', '')],
      [entry('Kumiba', ...Array.from({ length: 11 }, (_, index) => `alias${index}`))], Array.from({ length: 101 }, (_, index) => entry(`word${index}`)),
      [entry('Kumiba'), entry('KUMIBA')], [entry('Kumiba', 'kumiba')], [entry('Kumiba', 'kumba'), entry('Other', 'Kumba')], [entry('Kumiba', 'kumba', 'KUMBA')],
    ];
    for (const value of invalid) {
      expect(isCustomWords(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe('parseCustomWords and formatCustomWords', () => {
  it('reads one entry per line with optional comma-separated aliases after a colon', () => {
    expect(parseCustomWords(' Kumiba \n\n Kumiba   MCP :  kumiba em si pí ,kumba  MCP,, \r\nŽilina:')).toEqual([
      entry('Kumiba'), entry('Kumiba MCP', 'kumiba em si pí', 'kumba MCP'), entry('Žilina'),
    ]);
  });

  it('drops duplicate terms silently and keeps the first', () => {
    expect(parseCustomWords('Kumiba: kumba\nKUMIBA: kumiba app\nOther: Kumba, kumiba, othr\nŽilina\nŽilina')).toEqual([
      entry('Kumiba', 'kumba'), entry('Other', 'othr'), entry('Žilina'),
    ]);
  });

  it('leaves invalid terms for the validator to reject', () => {
    expect(isCustomWords(parseCustomWords(': kumba'))).toBe(false);
    expect(isCustomWords(parseCustomWords('Kumiba: a: b'))).toBe(false);
    expect(isCustomWords(parseCustomWords('a/b'))).toBe(false);
  });

  it('formats entries back into the same text', () => {
    const text = 'Kumiba\nKumiba MCP: kumiba em si pí, kumba MCP';
    expect(formatCustomWords(parseCustomWords(text))).toBe(text);
    expect(formatCustomWords([])).toBe('');
  });
});

describe('upgradeLegacyCustomWords', () => {
  it('turns stored plain words into entries without aliases and keeps the first of duplicates', () => {
    expect(upgradeLegacyCustomWords(['Kumiba', 'Žilina', 'KUMIBA', 'žilina'])).toEqual([entry('Kumiba'), entry('Žilina')]);
    expect(upgradeLegacyCustomWords([])).toEqual([]);
  });

  it('leaves the new shape and anything that is not a list of strings unchanged', () => {
    const current = [entry('Kumiba', 'kumba')];
    expect(upgradeLegacyCustomWords(current)).toBe(current);
    expect(upgradeLegacyCustomWords('Kumiba')).toBe('Kumiba');
    expect(upgradeLegacyCustomWords(['Kumiba', 7])).toEqual(['Kumiba', 7]);
  });
});

describe('preferredSpellings', () => {
  it('lists only the preferred spellings, never the aliases', () => {
    expect(preferredSpellings([entry('Kumiba', 'kumba'), entry('Kumiba MCP', 'kumiba em si pí')])).toEqual(['Kumiba', 'Kumiba MCP']);
  });
});
