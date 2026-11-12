export type Point = { readonly x: number; readonly y: number };

export type Box = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

export type Region<T> = { readonly id: T; readonly box: Box | null };

export const DRAG_THRESHOLD_PX = 4;

export function exceedsThreshold(start: Point, current: Point, threshold: number = DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}

export function contains(box: Box, point: Point): boolean {
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
}

export function regionAt<T>(point: Point, regions: readonly Region<T>[]): T | null {
  return regions.find((region) => region.box !== null && contains(region.box, point))?.id ?? null;
}

export function insertionIndex(rows: readonly Box[], y: number): number {
  const hit = rows.findIndex((row) => y < row.top + (row.bottom - row.top) / 2);
  return hit < 0 ? rows.length : hit;
}
