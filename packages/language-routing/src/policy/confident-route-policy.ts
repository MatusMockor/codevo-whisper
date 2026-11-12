import type { LanguageScores } from '../language-scores';
import type { LanguageSelection } from '../language-selection';
import { RoutingThresholds } from '../routing-thresholds';
import type { RouteDecision, RoutePolicy, RouteSelection, ScreeningDecision } from './route-policy';

export const MIN_IDENTIFIABLE_MS = 500;

export class ConfidentRoutePolicy implements RoutePolicy {
  constructor(private readonly thresholds: RoutingThresholds = RoutingThresholds.fleurs()) {}

  screen(selection: RouteSelection, segmentMs: number): ScreeningDecision {
    if (selection === 'auto') {
      return { kind: 'verbatim', route: 'auto' };
    }
    if (segmentMs < MIN_IDENTIFIABLE_MS) {
      return { kind: 'verbatim', route: 'verbatim-short' };
    }
    return { kind: 'identify', selection };
  }

  decide(selection: LanguageSelection, scores: LanguageScores): RouteDecision {
    if (scores.foreignWinner(selection, this.thresholds.foreign) !== null) {
      return { kind: 'verbatim', route: 'verbatim-foreign' };
    }
    const top = scores.restrictedTo(selection).top();
    if (selection.size === 1 || top.p >= this.thresholds.confidence) {
      return { kind: 'confident', language: top.code };
    }
    return { kind: 'unsure', language: top.code };
  }
}
