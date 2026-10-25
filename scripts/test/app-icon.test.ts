import { describe, expect, it } from 'vitest';
import { ICONSET_ENTRIES, rasterizeAppIcon } from '../icon/app-icon-raster.ts';

const SIZE = 256;

function pixel(rgba: Uint8Array, x: number, y: number): number[] {
  const offset = (y * SIZE + x) * 4;
  return Array.from(rgba.subarray(offset, offset + 4));
}

function at(rgba: Uint8Array, viewX: number, viewY: number): number[] {
  const toPixel = (value: number): number => Math.floor(((value - 12) / 64) * 0.8046875 * SIZE + 0.09765625 * SIZE);
  return pixel(rgba, toPixel(viewX), toPixel(viewY));
}

describe('rasterizeAppIcon', () => {
  const rgba = rasterizeAppIcon(SIZE);

  it('produces RGBA pixels for the requested size', () => {
    expect(rgba.byteLength).toBe(SIZE * SIZE * 4);
  });

  it('leaves the margin and the rounded corners transparent', () => {
    expect(pixel(rgba, 2, 2)[3]).toBe(0);
    expect(at(rgba, 13, 13)[3]).toBe(0);
  });

  it('fills the tile with the navy background', () => {
    expect(at(rgba, 52, 60)).toEqual([0x0b, 0x11, 0x20, 255]);
    expect(at(rgba, 15, 44)).toEqual([0x0b, 0x11, 0x20, 255]);
  });

  it('paints the upper right arc and the center dot cyan', () => {
    expect(at(rgba, 60, 36)).toEqual([0x22, 0xd3, 0xee, 255]);
    expect(at(rgba, 44, 44)).toEqual([0x22, 0xd3, 0xee, 255]);
  });

  it('paints the lower left arc light slate', () => {
    expect(at(rgba, 28, 52)).toEqual([0xe2, 0xe8, 0xf0, 255]);
  });
});

describe('ICONSET_ENTRIES', () => {
  it('lists every size iconutil expects', () => {
    expect(ICONSET_ENTRIES.map((entry) => `${entry.name}:${entry.pixels}`)).toEqual([
      'icon_16x16.png:16',
      'icon_16x16@2x.png:32',
      'icon_32x32.png:32',
      'icon_32x32@2x.png:64',
      'icon_128x128.png:128',
      'icon_128x128@2x.png:256',
      'icon_256x256.png:256',
      'icon_256x256@2x.png:512',
      'icon_512x512.png:512',
      'icon_512x512@2x.png:1024',
    ]);
  });
});
