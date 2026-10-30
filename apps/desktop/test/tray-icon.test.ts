import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { rasterizeMark, type MarkSpec } from '../src/main/tray/mark-raster';
import { encodePng } from '../src/main/tray/png';
import { trayIconSpec } from '../src/main/tray/tray-icons';

const SIZE = 32;
const PLAIN: MarkSpec = { color: [0, 0, 0, 1], rotationDeg: 0, badge: false };

function alphaAt(pixels: Uint8Array, column: number, row: number): number {
  return pixels[(row * SIZE + column) * 4 + 3] ?? -1;
}

function pngChunks(png: Buffer): Map<string, Buffer> {
  const chunks = new Map<string, Buffer>();
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    chunks.set(type, png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  return chunks;
}

describe('rasterizeMark', () => {
  it('fills the center dot and the arcs and leaves the corners and the gap transparent', () => {
    const pixels = rasterizeMark(SIZE, PLAIN);

    expect(alphaAt(pixels, 16, 16)).toBe(255);
    expect(alphaAt(pixels, 16, 2)).toBe(255);
    expect(alphaAt(pixels, 15, 29)).toBe(255);
    expect(alphaAt(pixels, 0, 0)).toBe(0);
    expect(alphaAt(pixels, 16, 10)).toBe(0);
    expect(alphaAt(pixels, 9, 5)).toBe(0);
  });

  it('rotates the arcs for the processing frames', () => {
    const still = rasterizeMark(SIZE, PLAIN);
    const turned = rasterizeMark(SIZE, { ...PLAIN, rotationDeg: 90 });

    expect(turned).not.toEqual(still);
    expect(rasterizeMark(SIZE, { ...PLAIN, rotationDeg: 180 })).toEqual(still);
  });

  it('draws the error badge with a transparent ring around it', () => {
    const pixels = rasterizeMark(SIZE, { ...PLAIN, badge: true });

    expect(alphaAt(pixels, 27, 4)).toBe(255);
    expect(rasterizeMark(SIZE, PLAIN)).not.toEqual(pixels);
  });

  it('scales the alpha for the dimmed paused icon', () => {
    expect(alphaAt(rasterizeMark(SIZE, { ...PLAIN, color: [0, 0, 0, 0.45] }), 16, 16)).toBe(115);
  });
});

describe('encodePng', () => {
  it('writes a valid RGBA PNG with one filter byte per row', () => {
    const pixels = rasterizeMark(SIZE, PLAIN);
    const png = encodePng(SIZE, SIZE, pixels);
    const chunks = pngChunks(png);
    const header = chunks.get('IHDR');
    const raw = inflateSync(chunks.get('IDAT') ?? Buffer.alloc(0));

    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect([header?.readUInt32BE(0), header?.readUInt32BE(4), header?.[8], header?.[9]]).toEqual([SIZE, SIZE, 8, 6]);
    expect(raw).toHaveLength((SIZE * 4 + 1) * SIZE);
    expect(raw[0]).toBe(0);
    expect(new Uint8Array(raw.subarray(1, 1 + SIZE * 4))).toEqual(pixels.subarray(0, SIZE * 4));
    expect(chunks.has('IEND')).toBe(true);
  });

  it('rejects a pixel buffer of the wrong size', () => {
    expect(() => encodePng(2, 2, new Uint8Array(3))).toThrow(RangeError);
  });
});

describe('trayIconSpec', () => {
  it('uses an amber icon while recording and template icons otherwise', () => {
    expect(trayIconSpec('recording', 'darwin')).toMatchObject({ color: [240, 162, 58, 1], template: false });
    expect(trayIconSpec('idle', 'darwin')).toMatchObject({ template: true, badge: false });
    expect(trayIconSpec('error', 'darwin')).toMatchObject({ template: true, badge: true });
    expect(trayIconSpec('paused', 'darwin')).toMatchObject({ template: true, color: [0, 0, 0, 0.45] });
    expect(trayIconSpec('processing', 'darwin', 3).rotationDeg).toBe(45);
  });

  it('draws white icons on Linux, where the panel is dark and template images are not inverted', () => {
    expect(trayIconSpec('idle', 'linux').color).toEqual([255, 255, 255, 1]);
    expect(trayIconSpec('processing', 'linux', 3).color).toEqual([255, 255, 255, 1]);
    expect(trayIconSpec('paused', 'linux').color).toEqual([255, 255, 255, 0.45]);
    expect(trayIconSpec('recording', 'linux').color).toEqual([240, 162, 58, 1]);
  });
});
