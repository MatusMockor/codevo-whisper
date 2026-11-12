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

export type Span = { readonly top: number; readonly bottom: number };

export const EDGE_SCROLL_PX = 48;

export const MAX_EDGE_SCROLL_STEP = 20;

export function edgeScrollStep(y: number, span: Span, edge: number = EDGE_SCROLL_PX, max: number = MAX_EDGE_SCROLL_STEP): number {
  const fromTop = y - span.top;
  if (fromTop < edge) {
    return -Math.ceil(max * Math.min(1, (edge - fromTop) / edge));
  }
  const fromBottom = span.bottom - y;
  if (fromBottom < edge) {
    return Math.ceil(max * Math.min(1, (edge - fromBottom) / edge));
  }
  return 0;
}

export function visibleSpan(box: Span | null, viewportHeight: number): Span {
  if (box === null) {
    return { top: 0, bottom: viewportHeight };
  }
  return { top: Math.max(box.top, 0), bottom: Math.min(box.bottom, viewportHeight) };
}

const SCROLLING_OVERFLOW: ReadonlySet<string> = new Set(['auto', 'scroll', 'overlay']);

export function scrollsVertically(overflowY: string, scrollHeight: number, clientHeight: number): boolean {
  return SCROLLING_OVERFLOW.has(overflowY) && scrollHeight > clientHeight;
}
