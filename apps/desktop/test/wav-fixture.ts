import { readFile } from 'node:fs/promises';
import { expect } from 'vitest';

export async function readWavPcm(file: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(await readFile(file));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number): string => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  expect(tag(0)).toBe('RIFF');
  expect(tag(8)).toBe('WAVE');
  let offset = 12;
  while (offset + 8 <= bytes.byteLength && tag(offset) !== 'data') {
    offset += 8 + view.getUint32(offset + 4, true) + (view.getUint32(offset + 4, true) % 2);
  }
  expect(tag(offset)).toBe('data');
  return bytes.subarray(offset + 8, offset + 8 + view.getUint32(offset + 4, true));
}
