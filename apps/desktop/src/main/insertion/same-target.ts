import type { AppTarget } from '../helper/input-helper';

function sameWindow(expected: number | null, current: number | null): boolean {
  return expected === null || current === null || expected === current;
}

export function isSameTarget(expected: AppTarget | null, current: AppTarget | null): boolean {
  if (expected === null || current === null) {
    return expected === current;
  }
  return expected.pid === current.pid && expected.bundleId === current.bundleId && sameWindow(expected.windowId, current.windowId);
}
