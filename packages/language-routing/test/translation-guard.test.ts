import { describe, expect, it } from 'vitest';
import { LanguageSelection } from '../src/language-selection';
import { RoutingThresholds } from '../src/routing-thresholds';
import { OrthographyCheck } from '../src/text/orthography-check';
import { characterSimilarity, TranslationGuard } from '../src/text/translation-guard';
import { CS_TWENTIES, EN_CABBAGE, EN_CABBAGE_SHORT, SK_GIBSON, SK_GOVERNOR_CZECH_DRIFT, SK_GOVERNOR_SHORT, SK_GREETING, SK_METHODS_SHORT, UK_DRIFT } from './support/benchmark-texts';

const guard = new TranslationGuard();
const SK_EN = LanguageSelection.of(['sk', 'en']);
const SK_CS = LanguageSelection.of(['sk', 'cs']);
const SK_CS_EN = LanguageSelection.of(['sk', 'cs', 'en']);

describe('characterSimilarity', () => {
  it('ignores case, diacritics, punctuation and spacing', () => {
    expect(characterSimilarity('Úrad guvernéra informoval, že boli', 'urad  guvernera informoval ze boli')).toBe(1);
  });

  it('is 1 - levenshtein / longer length', () => {
    expect(characterSimilarity('abcd', 'abxd')).toBe(0.75);
    expect(characterSimilarity('abc', '')).toBe(0);
    expect(characterSimilarity('', '')).toBe(1);
  });

  it('separates a correct hint from a translation on the benchmark pairs', () => {
    expect(characterSimilarity(SK_GIBSON.canarySk, SK_GIBSON.parakeet)).toBeGreaterThan(0.9);
    expect(characterSimilarity(SK_GIBSON.canaryEn, SK_GIBSON.parakeet)).toBeLessThan(0.5);
  });
});

describe('TranslationGuard', () => {
  it.each([
    { name: 'Slovak full clip', conditioned: SK_GIBSON.canarySk, verbatim: SK_GIBSON.parakeet, selection: SK_EN },
    { name: 'Slovak 2 s crop', conditioned: SK_GOVERNOR_SHORT.canarySk, verbatim: SK_GOVERNOR_SHORT.parakeet, selection: SK_CS_EN },
    { name: 'English full clip', conditioned: EN_CABBAGE.canaryEn, verbatim: EN_CABBAGE.parakeet, selection: SK_EN },
    { name: 'Czech full clip', conditioned: CS_TWENTIES.canaryCs, verbatim: CS_TWENTIES.parakeet, selection: SK_CS },
  ])('accepts a correct hint: $name', ({ conditioned, verbatim, selection }) => {
    expect(guard.accepts(conditioned, verbatim, selection)).toBe(true);
  });

  it.each([
    { name: 'Slovak translated to English', conditioned: SK_GIBSON.canaryEn, verbatim: SK_GIBSON.parakeet, selection: SK_EN },
    { name: 'Slovak 2 s crop translated to English', conditioned: SK_GOVERNOR_SHORT.canaryEn, verbatim: SK_GOVERNOR_SHORT.parakeet, selection: SK_CS_EN },
    { name: 'English translated to Slovak', conditioned: EN_CABBAGE.canarySk, verbatim: EN_CABBAGE.parakeet, selection: SK_EN },
    { name: 'English swallowed by a Slovak hint', conditioned: EN_CABBAGE_SHORT.canarySk, verbatim: EN_CABBAGE_SHORT.parakeet, selection: SK_EN },
  ])('rejects a translation: $name', ({ conditioned, verbatim, selection }) => {
    expect(guard.accepts(conditioned, verbatim, selection)).toBe(false);
  });

  it('cannot tell Slovak from Czech, which is the confidence gate job', () => {
    expect(guard.accepts(SK_METHODS_SHORT.canaryCs, SK_METHODS_SHORT.parakeet, SK_CS)).toBe(true);
    expect(guard.accepts(SK_GIBSON.canaryCs, SK_GIBSON.parakeet, SK_CS)).toBe(true);
  });

  it.each([LanguageSelection.of(['sk']), SK_CS, SK_CS_EN])('never lets Cyrillic verbatim text win over Latin Canary text', (selection) => {
    expect(guard.accepts(SK_GREETING, UK_DRIFT, selection)).toBe(true);
    expect(guard.accepts('', UK_DRIFT, selection)).toBe(true);
  });

  it('never lets verbatim text with letters outside the selection win', () => {
    expect(guard.accepts(SK_GIBSON.canaryEn, SK_GOVERNOR_CZECH_DRIFT, LanguageSelection.of(['sk', 'en']))).toBe(true);
  });

  it('follows the similarity threshold it is given', () => {
    const strict = new TranslationGuard(new OrthographyCheck(), RoutingThresholds.of({ confidence: 0.99, foreign: 0.99, guardSimilarity: 0.999 }));

    expect(strict.accepts(SK_GIBSON.canarySk, SK_GIBSON.parakeet, SK_EN)).toBe(false);
  });
});
