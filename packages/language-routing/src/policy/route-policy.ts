import type { LanguageScores } from '../language-scores';
import type { LanguageSelection } from '../language-selection';
import type { SupportedLanguage } from '../languages';

export type RouteSelection = LanguageSelection | 'auto';

export type ScreeningDecision = { kind: 'verbatim'; route: 'auto' | 'verbatim-short' } | { kind: 'identify'; selection: LanguageSelection };

export type RouteDecision = { kind: 'verbatim'; route: 'verbatim-foreign' } | { kind: 'unsure'; language: SupportedLanguage } | { kind: 'confident'; language: SupportedLanguage };

export interface RoutePolicy {
  screen(selection: RouteSelection, segmentMs: number): ScreeningDecision;
  decide(selection: LanguageSelection, scores: LanguageScores): RouteDecision;
}
