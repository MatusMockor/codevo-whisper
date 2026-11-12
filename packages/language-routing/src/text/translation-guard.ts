import type { LanguageSelection } from '../language-selection';
import { RoutingThresholds } from '../routing-thresholds';
import { foldText } from './fold-text';
import { levenshtein } from './levenshtein';
import { OrthographyCheck } from './orthography-check';

export function characterSimilarity(a: string, b: string): number {
  const left = Array.from(foldText(a));
  const right = Array.from(foldText(b));
  const longest = Math.max(left.length, right.length);
  if (longest === 0) {
    return 1;
  }
  return 1 - levenshtein(left, right) / longest;
}

export class TranslationGuard {
  constructor(
    private readonly orthography: OrthographyCheck = new OrthographyCheck(),
    private readonly thresholds: RoutingThresholds = RoutingThresholds.fleurs(),
  ) {}

  accepts(conditioned: string, verbatim: string, selection: LanguageSelection): boolean {
    if (conditioned.trim() === '' && verbatim.trim() !== '') {
      return false;
    }
    if (!this.orthography.isConsistent(verbatim, selection)) {
      return true;
    }
    return characterSimilarity(conditioned, verbatim) >= this.thresholds.guardSimilarity;
  }
}
