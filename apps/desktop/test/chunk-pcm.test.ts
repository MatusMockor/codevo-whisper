import { describe, expect, it } from 'vitest';
import { chunkPcm } from '../src/main/engines/chunk-pcm';
import { PCM_BYTES_PER_SECOND } from '../src/shared/pcm';

const seconds = (count: number): Uint8Array => new Uint8Array(count * PCM_BYTES_PER_SECOND);

describe('chunkPcm', () => {
  it('cuts 60 s into 25, 25 and 10 s', () => {
    const chunks = chunkPcm(seconds(60));

    expect(chunks.map((chunk) => chunk.byteLength / PCM_BYTES_PER_SECOND)).toEqual([25, 25, 10]);
  });

  it('keeps the bytes in order', () => {
    const pcm = new Uint8Array(2400).map((_, index) => index % 251);

    const chunks = chunkPcm(pcm, 800 / PCM_BYTES_PER_SECOND);

    expect(chunks).toEqual([pcm.subarray(0, 800), pcm.subarray(800, 1600), pcm.subarray(1600, 2400)]);
  });

  it('never splits a sample', () => {
    const chunks = chunkPcm(new Uint8Array(PCM_BYTES_PER_SECOND + 641), 0.5);

    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([16000, 16000, 640]);
  });

  it('rounds an odd chunk size down to whole samples', () => {
    const chunks = chunkPcm(new Uint8Array(2000), 999 / PCM_BYTES_PER_SECOND);

    expect(chunks.every((chunk) => chunk.byteLength % 2 === 0)).toBe(true);
    expect(chunks[0]?.byteLength).toBe(998);
  });

  it('drops a tail under 640 bytes', () => {
    const chunks = chunkPcm(new Uint8Array(25 * PCM_BYTES_PER_SECOND + 638));

    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([25 * PCM_BYTES_PER_SECOND]);
  });

  it('returns nothing for audio shorter than 640 bytes', () => {
    expect(chunkPcm(new Uint8Array(638))).toEqual([]);
    expect(chunkPcm(new Uint8Array(0))).toEqual([]);
  });
});
