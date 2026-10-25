import { pauseLength, pauseMidpoint, type Pause } from './pause';

export function selectCut(candidates: Pause[]): number | undefined {
  const longest = candidates.reduce<Pause | undefined>((best, pause) => {
    if (best === undefined || pauseLength(pause) >= pauseLength(best)) {
      return pause;
    }
    return best;
  }, undefined);
  return longest === undefined ? undefined : pauseMidpoint(longest);
}
