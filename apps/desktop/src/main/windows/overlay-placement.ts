export type Rect = { x: number; y: number; width: number; height: number };

export type Size = { width: number; height: number };

export const OVERLAY_SIZE: Size = Object.freeze({ width: 460, height: 184 });

export const OVERLAY_BOTTOM_MARGIN = 28;

export function bottomCenter(workArea: Rect, size: Size = OVERLAY_SIZE, margin = OVERLAY_BOTTOM_MARGIN): Rect {
  return {
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + workArea.height - size.height - margin),
    width: size.width,
    height: size.height,
  };
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.width > 0 && inner.height > 0 && inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

export function displayWorkArea(display: { bounds: Rect; workArea: Rect }, areas: readonly Rect[]): Rect {
  return areas.find((area) => contains(display.bounds, area)) ?? display.workArea;
}
