import type { OverlayState } from '../../shared/overlay-contract';

export const WAVE_BARS = 26;

export function nextLevelHistory(history: readonly number[], state: OverlayState): number[] {
  if (state.kind !== 'recording') {
    return [];
  }
  return [...history, state.level].slice(-WAVE_BARS);
}

export function barScale(level: number): number {
  return Math.max(0.08, Math.min(1, Math.sqrt(level) * 1.6));
}

export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const seconds = totalSeconds % 60;
  return `${Math.floor(totalSeconds / 60)}:${seconds.toString().padStart(2, '0')}`;
}
