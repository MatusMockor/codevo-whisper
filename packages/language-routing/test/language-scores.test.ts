import { describe, expect, it } from 'vitest';
import { LanguageScores } from '../src/language-scores';
import { LanguageSelection } from '../src/language-selection';
import { SUPPORTED_LANGUAGES } from '../src/languages';
import { CS_1746_HEARD_AS_SK, CS_1762_HEARD_AS_PL, CS_1909_JUST_UNDER_GATE } from './support/benchmark-rows';

const SK_CS_EN = LanguageSelection.of(['sk', 'cs', 'en']);

describe('LanguageScores', () => {
  it('holds one probability per supported language, missing codes as zero', () => {
    const scores = LanguageScores.from(CS_1762_HEARD_AS_PL);

    expect(scores.rows.map((row) => row.code)).toEqual([...SUPPORTED_LANGUAGES]);
    expect(scores.rows.find((row) => row.code === 'en')?.p).toBe(0);
    expect(scores.rows.reduce((sum, row) => sum + row.p, 0)).toBeCloseTo(1, 9);
  });

  it('renormalises over the selection in selection order', () => {
    const restricted = LanguageScores.from(CS_1909_JUST_UNDER_GATE).restrictedTo(SK_CS_EN);

    expect(restricted.rows.map((row) => row.code)).toEqual(['sk', 'cs', 'en']);
    expect(restricted.rows[0]?.p).toBeCloseTo(0.4595 / (0.4595 + 0.0049), 9);
    expect(restricted.rows[2]?.p).toBe(0);
  });

  it('picks the most probable language of the restricted set', () => {
    const top = LanguageScores.from(CS_1746_HEARD_AS_SK).restrictedTo(SK_CS_EN).top();

    expect(top.code).toBe('sk');
    expect(top.p).toBeCloseTo(0.5366 / (0.5366 + 0.2808), 9);
  });

  it('resolves a tie by the selection order', () => {
    const tie = LanguageScores.from([
      { code: 'sk', p: 0.5 },
      { code: 'cs', p: 0.5 },
    ]);

    expect(tie.restrictedTo(LanguageSelection.of(['cs', 'sk'])).top()).toEqual({ code: 'cs', p: 0.5 });
    expect(tie.restrictedTo(LanguageSelection.of(['sk', 'cs'])).top()).toEqual({ code: 'sk', p: 0.5 });
  });

  it('spreads the mass evenly when the selection got no probability at all', () => {
    const restricted = LanguageScores.from(CS_1762_HEARD_AS_PL).restrictedTo(LanguageSelection.of(['en', 'de']));

    expect(restricted.rows).toEqual([
      { code: 'en', p: 0.5 },
      { code: 'de', p: 0.5 },
    ]);
  });

  it('reports a confident winner outside the selection as foreign', () => {
    const scores = LanguageScores.from(CS_1762_HEARD_AS_PL);

    expect(scores.foreignWinner(SK_CS_EN, 0.99)?.code).toBe('pl');
    expect(scores.foreignWinner(SK_CS_EN, 0.995)).toBeNull();
    expect(scores.foreignWinner(LanguageSelection.of(['pl']), 0.99)).toBeNull();
  });

  it('never reports a foreign winner when the leader is unsure', () => {
    expect(LanguageScores.from(CS_1909_JUST_UNDER_GATE).foreignWinner(LanguageSelection.of(['en']), 0.99)).toBeNull();
  });
});
