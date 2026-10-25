export type Rgba = readonly [number, number, number, number];

export type MarkSpec = { color: Rgba; rotationDeg: number; badge: boolean };

const CENTER = 44;
const VIEW_MIN = 17;
const VIEW_SIZE = 54;
const INNER_RADIUS = 14;
const OUTER_RADIUS = 26;
const DOT_RADIUS = 3.2;
const SECTOR_STARTS = [-90, 90] as const;
const SECTOR_SPAN = 120;
const BADGE = Object.freeze({ x: 63, y: 25, radius: 7.5, gap: 3 });
const SAMPLES = 4;

function inSector(angle: number, start: number): boolean {
  return (((angle - start) % 360) + 360) % 360 <= SECTOR_SPAN;
}

function inMark(x: number, y: number, rotationDeg: number): boolean {
  const radius = Math.hypot(x - CENTER, y - CENTER);
  if (radius <= DOT_RADIUS) {
    return true;
  }
  if (radius < INNER_RADIUS || radius > OUTER_RADIUS) {
    return false;
  }
  const angle = (Math.atan2(y - CENTER, x - CENTER) * 180) / Math.PI - rotationDeg;
  return SECTOR_STARTS.some((start) => inSector(angle, start));
}

function badgeDistance(x: number, y: number): number {
  return Math.hypot(x - BADGE.x, y - BADGE.y);
}

function shapeAt(x: number, y: number, spec: MarkSpec): boolean {
  if (spec.badge && badgeDistance(x, y) <= BADGE.radius) {
    return true;
  }
  if (spec.badge && badgeDistance(x, y) <= BADGE.radius + BADGE.gap) {
    return false;
  }
  return inMark(x, y, spec.rotationDeg);
}

function coverage(column: number, row: number, size: number, spec: MarkSpec): number {
  let hits = 0;
  for (let sy = 0; sy < SAMPLES; sy += 1) {
    for (let sx = 0; sx < SAMPLES; sx += 1) {
      const x = VIEW_MIN + ((column + (sx + 0.5) / SAMPLES) * VIEW_SIZE) / size;
      const y = VIEW_MIN + ((row + (sy + 0.5) / SAMPLES) * VIEW_SIZE) / size;
      hits += shapeAt(x, y, spec) ? 1 : 0;
    }
  }
  return hits / (SAMPLES * SAMPLES);
}

export function rasterizeMark(size: number, spec: MarkSpec): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const [red, green, blue, alpha] = spec.color;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const offset = (row * size + column) * 4;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = Math.round(coverage(column, row, size, spec) * alpha * 255);
    }
  }
  return pixels;
}
