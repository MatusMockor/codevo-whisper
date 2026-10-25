type Rgb = readonly [number, number, number];

const VIEW_MIN = 12;
const VIEW_SIZE = 64;
const TILE_SCALE = 824 / 1024;
const TILE_OFFSET = 100 / 1024;
const TILE_RADIUS = 15;
const CENTER = 44;
const INNER_RADIUS = 14;
const OUTER_RADIUS = 26;
const DOT_RADIUS = 3.2;
const SECTOR_SPAN = 120;
const SAMPLES = 4;

const NAVY: Rgb = [0x0b, 0x11, 0x20];
const CYAN: Rgb = [0x22, 0xd3, 0xee];
const SLATE: Rgb = [0xe2, 0xe8, 0xf0];

export type IconsetEntry = { name: string; pixels: number };

export const ICONSET_ENTRIES: readonly IconsetEntry[] = [16, 32, 128, 256, 512].flatMap((points) => [
  { name: `icon_${points}x${points}.png`, pixels: points },
  { name: `icon_${points}x${points}@2x.png`, pixels: points * 2 },
]);

function inTile(x: number, y: number): boolean {
  const nearestX = Math.min(Math.max(x, VIEW_MIN + TILE_RADIUS), VIEW_MIN + VIEW_SIZE - TILE_RADIUS);
  const nearestY = Math.min(Math.max(y, VIEW_MIN + TILE_RADIUS), VIEW_MIN + VIEW_SIZE - TILE_RADIUS);
  const insideBox = x >= VIEW_MIN && x <= VIEW_MIN + VIEW_SIZE && y >= VIEW_MIN && y <= VIEW_MIN + VIEW_SIZE;
  return insideBox && Math.hypot(x - nearestX, y - nearestY) <= TILE_RADIUS;
}

function inSector(angle: number, start: number): boolean {
  return (((angle - start) % 360) + 360) % 360 <= SECTOR_SPAN;
}

function colorAt(x: number, y: number): Rgb | null {
  if (!inTile(x, y)) {
    return null;
  }
  const radius = Math.hypot(x - CENTER, y - CENTER);
  if (radius <= DOT_RADIUS) {
    return CYAN;
  }
  if (radius < INNER_RADIUS || radius > OUTER_RADIUS) {
    return NAVY;
  }
  const angle = (Math.atan2(y - CENTER, x - CENTER) * 180) / Math.PI;
  if (inSector(angle, -90)) {
    return CYAN;
  }
  return inSector(angle, 90) ? SLATE : NAVY;
}

function toView(pixel: number, size: number): number {
  return VIEW_MIN + ((pixel / size - TILE_OFFSET) / TILE_SCALE) * VIEW_SIZE;
}

function samplePixel(column: number, row: number, size: number): [number, number, number, number] {
  const sum = { red: 0, green: 0, blue: 0, hits: 0 };
  for (let sy = 0; sy < SAMPLES; sy += 1) {
    for (let sx = 0; sx < SAMPLES; sx += 1) {
      const color = colorAt(toView(column + (sx + 0.5) / SAMPLES, size), toView(row + (sy + 0.5) / SAMPLES, size));
      if (color === null) {
        continue;
      }
      sum.red += color[0];
      sum.green += color[1];
      sum.blue += color[2];
      sum.hits += 1;
    }
  }
  if (sum.hits === 0) {
    return [0, 0, 0, 0];
  }
  return [Math.round(sum.red / sum.hits), Math.round(sum.green / sum.hits), Math.round(sum.blue / sum.hits), Math.round((sum.hits / (SAMPLES * SAMPLES)) * 255)];
}

export function rasterizeAppIcon(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      pixels.set(samplePixel(column, row, size), (row * size + column) * 4);
    }
  }
  return pixels;
}
