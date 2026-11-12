import { describe, expect, it } from 'vitest';
import { LanguageScores } from '../src/language-scores';
import { LanguageSelection } from '../src/language-selection';
import type { LanguageScore } from '../src/languages';
import { ConfidentRoutePolicy, MIN_IDENTIFIABLE_MS } from '../src/policy/confident-route-policy';
import type { RouteDecision } from '../src/policy/route-policy';
import { RoutingThresholds } from '../src/routing-thresholds';
import {
  CS_1664_CONFIDENT,
  CS_1746_HEARD_AS_SK,
  CS_1762_HEARD_AS_PL,
  CS_1909_JUST_UNDER_GATE,
  CS_1915_HEARD_AS_SK,
  EN_1904_CONFIDENT,
  SK_1961_CONFIDENT,
  SK_1986_LOW,
} from './support/benchmark-rows';

const policy = new ConfidentRoutePolicy();

type PolicyRow = { name: string; selection: string[]; rows: readonly LanguageScore[]; decision: RouteDecision };

const TABLE: PolicyRow[] = [
  { name: 'confident Slovak among sk, cs, en', selection: ['sk', 'cs', 'en'], rows: SK_1961_CONFIDENT, decision: { kind: 'confident', language: 'sk' } },
  { name: 'confident Czech among sk, cs', selection: ['sk', 'cs'], rows: CS_1664_CONFIDENT, decision: { kind: 'confident', language: 'cs' } },
  { name: 'English selected next to Slovak', selection: ['sk', 'en'], rows: EN_1904_CONFIDENT, decision: { kind: 'confident', language: 'en' } },
  { name: 'Czech heard as Slovak at 0.66 stays unsure', selection: ['sk', 'cs', 'en'], rows: CS_1746_HEARD_AS_SK, decision: { kind: 'unsure', language: 'sk' } },
  { name: 'Czech heard as Slovak at 0.989 stays unsure', selection: ['sk', 'cs', 'en'], rows: CS_1909_JUST_UNDER_GATE, decision: { kind: 'unsure', language: 'sk' } },
  { name: 'unsure Slovak among sk, cs', selection: ['sk', 'cs'], rows: SK_1986_LOW, decision: { kind: 'unsure', language: 'sk' } },
  { name: 'English is foreign to Slovak alone', selection: ['sk'], rows: EN_1904_CONFIDENT, decision: { kind: 'verbatim', route: 'verbatim-foreign' } },
  { name: 'Czech heard as Polish is foreign to sk, cs, en', selection: ['sk', 'cs', 'en'], rows: CS_1762_HEARD_AS_PL, decision: { kind: 'verbatim', route: 'verbatim-foreign' } },
  { name: 'a single language is confident even at 0.30', selection: ['sk'], rows: SK_1986_LOW, decision: { kind: 'confident', language: 'sk' } },
  { name: 'a single language takes a close neighbour', selection: ['sk'], rows: CS_1915_HEARD_AS_SK, decision: { kind: 'confident', language: 'sk' } },
  { name: 'a single language takes unsure foreign speech', selection: ['en'], rows: CS_1909_JUST_UNDER_GATE, decision: { kind: 'confident', language: 'en' } },
];

describe('ConfidentRoutePolicy.decide', () => {
  it.each(TABLE)('$name', ({ selection, rows, decision }) => {
    expect(policy.decide(LanguageSelection.of(selection), LanguageScores.from(rows))).toEqual(decision);
  });

  it('resolves an even split by the selection order', () => {
    const tie = LanguageScores.from([
      { code: 'sk', p: 0.5 },
      { code: 'cs', p: 0.5 },
    ]);

    expect(policy.decide(LanguageSelection.of(['cs', 'sk']), tie)).toEqual({ kind: 'unsure', language: 'cs' });
    expect(policy.decide(LanguageSelection.of(['sk', 'cs']), tie)).toEqual({ kind: 'unsure', language: 'sk' });
  });

  it('opens the gate exactly at the confidence threshold', () => {
    const atGate = LanguageScores.from([
      { code: 'sk', p: 0.99 },
      { code: 'cs', p: 0.01 },
    ]);

    expect(policy.decide(LanguageSelection.of(['sk', 'cs']), atGate)).toEqual({ kind: 'confident', language: 'sk' });
  });

  it('follows the thresholds it is given', () => {
    const lenient = new ConfidentRoutePolicy(RoutingThresholds.of({ confidence: 0.95, foreign: 0.999, guardSimilarity: 0.5 }));
    const selection = LanguageSelection.of(['sk', 'cs', 'en']);

    expect(lenient.decide(selection, LanguageScores.from(CS_1909_JUST_UNDER_GATE))).toEqual({ kind: 'confident', language: 'sk' });
    expect(lenient.decide(selection, LanguageScores.from(CS_1762_HEARD_AS_PL))).toEqual({ kind: 'unsure', language: 'cs' });
  });
});

describe('ConfidentRoutePolicy.screen', () => {
  const selection = LanguageSelection.of(['sk', 'cs']);

  it('keeps automatic mode verbatim for any length', () => {
    expect(policy.screen('auto', 2_000)).toEqual({ kind: 'verbatim', route: 'auto' });
    expect(policy.screen('auto', 100)).toEqual({ kind: 'verbatim', route: 'auto' });
  });

  it('keeps segments under 500 ms verbatim', () => {
    expect(policy.screen(selection, MIN_IDENTIFIABLE_MS - 0.1)).toEqual({ kind: 'verbatim', route: 'verbatim-short' });
  });

  it('identifies the language from 500 ms on', () => {
    expect(policy.screen(selection, MIN_IDENTIFIABLE_MS)).toEqual({ kind: 'identify', selection });
  });
});

describe('RoutingThresholds', () => {
  it('uses the FLEURS calibration by default', () => {
    expect(RoutingThresholds.fleurs()).toMatchObject({ confidence: 0.99, foreign: 0.99, guardSimilarity: 0.5 });
  });

  it.each([-0.1, 1.5, Number.NaN])('rejects %s', (value) => {
    expect(() => RoutingThresholds.of({ confidence: 0.99, foreign: value, guardSimilarity: 0.5 })).toThrow('foreign');
  });
});
