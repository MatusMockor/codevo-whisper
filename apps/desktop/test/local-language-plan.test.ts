import { describe, expect, it } from 'vitest';
import { localLanguagePlan, needsLanguagePack } from '../src/main/engines/local-language';
import type { LanguageSelection } from '../src/shared/dictation-languages';

const AUTO: LanguageSelection = { mode: 'auto', selected: ['sk'] };
const SK_CS: LanguageSelection = { mode: 'selected', selected: ['sk', 'cs'] };

describe('local language plan', () => {
  it('keeps automatic mode on the active model without a hint and never needs the pack', () => {
    expect(localLanguagePlan(AUTO, 'ignored', false)).toEqual({ kind: 'direct', hint: 'auto' });
    expect(localLanguagePlan(AUTO, 'optional', true)).toEqual({ kind: 'direct', hint: 'auto' });
    expect(localLanguagePlan(AUTO, 'required', true)).toEqual({ kind: 'unavailable', reason: 'languages-required' });
    expect(needsLanguagePack(AUTO, 'ignored')).toBe(false);
  });

  it('hints a language-conditioned active model with the primary language and never routes it', () => {
    expect(localLanguagePlan({ mode: 'selected', selected: ['de', 'sk'] }, 'required', false)).toEqual({ kind: 'direct', hint: 'de' });
    expect(localLanguagePlan(SK_CS, 'required', true)).toEqual({ kind: 'direct', hint: 'sk' });
    expect(needsLanguagePack(SK_CS, 'required')).toBe(false);
  });

  it('routes a model without language conditioning only with the language pack', () => {
    expect(needsLanguagePack(SK_CS, 'ignored')).toBe(true);
    expect(needsLanguagePack(SK_CS, 'optional')).toBe(true);
    expect(needsLanguagePack(SK_CS, null)).toBe(true);
    expect(localLanguagePlan(SK_CS, 'ignored', false)).toEqual({ kind: 'unavailable', reason: 'languages-pack-missing' });
    expect(localLanguagePlan(SK_CS, 'optional', true)).toEqual({ kind: 'routed', selected: ['sk', 'cs'] });
    expect(localLanguagePlan(SK_CS, 'ignored', true)).toEqual({ kind: 'routed', selected: ['sk', 'cs'] });
  });
});
