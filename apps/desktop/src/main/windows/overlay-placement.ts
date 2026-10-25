export type Rect = { x: number; y: number; width: number; height: number };

export type Size = { width: number; height: number };

export const OVERLAY_SIZE: Size = Object.freeze({ width: 420, height: 168 });

export const OVERLAY_BOTTOM_MARGIN = 28;

export function bottomCenter(workArea: Rect, size: Size = OVERLAY_SIZE, margin = OVERLAY_BOTTOM_MARGIN): Rect {
  return {
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + workArea.height - size.height - margin),
    width: size.width,
    height: size.height,
  };
}
