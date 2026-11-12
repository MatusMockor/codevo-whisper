import { describe, expect, it } from 'vitest';
import { LanguageSelection } from '../src/language-selection';

describe('LanguageSelection', () => {
  it('keeps the chosen order and makes the first language the primary one', () => {
    const selection = LanguageSelection.of(['cs', 'sk', 'en']);

    expect(selection.codes).toEqual(['cs', 'sk', 'en']);
    expect(selection.primary()).toBe('cs');
    expect(selection.size).toBe(3);
  });

  it('answers membership for supported and unknown codes', () => {
    const selection = LanguageSelection.of(['sk', 'en']);

    expect(selection.has('sk')).toBe(true);
    expect(selection.has('cs')).toBe(false);
    expect(selection.has('xx')).toBe(false);
  });

  it.each([
    { codes: [], reason: 'at least one' },
    { codes: ['sk', 'cs', 'en', 'de', 'pl', 'hu'], reason: 'at most 5' },
    { codes: ['sk', 'sr'], reason: 'unsupported language "sr"' },
    { codes: ['sk', 'cs', 'sk'], reason: 'each language once' },
  ])('rejects $codes', ({ codes, reason }) => {
    expect(LanguageSelection.isValid(codes)).toBe(false);
    expect(() => LanguageSelection.of(codes)).toThrow(RangeError);
    expect(() => LanguageSelection.of(codes)).toThrow(reason);
  });

  it('accepts five unique supported languages', () => {
    expect(LanguageSelection.isValid(['sk', 'cs', 'en', 'de', 'uk'])).toBe(true);
  });

  it('cannot be changed through its codes', () => {
    const selection = LanguageSelection.of(['sk']);

    expect(Object.isFrozen(selection.codes)).toBe(true);
  });
});
