import { describe, expect, it } from 'vitest';
import { chunkAudio } from '../src/stt/chunk-audio';
import { BYTES_PER_SECOND, pcmSeconds } from './support/pcm';

describe('chunkAudio', () => {
  it('splits 60 s of PCM into 25 s, 25 s and 10 s', () => {
    const pcm = pcmSeconds(60);
    pcm[25 * BYTES_PER_SECOND] = 7;
    const chunks = chunkAudio(pcm);

    expect(chunks.map((chunk) => chunk.length / BYTES_PER_SECOND)).toEqual([25, 25, 10]);
    expect(chunks[1]?.[0]).toBe(7);
  });

  it('honours maxSeconds', () => {
    expect(chunkAudio(pcmSeconds(5), 2).map((chunk) => chunk.length / BYTES_PER_SECOND)).toEqual([2, 2, 1]);
  });

  it('rejects an odd input length', () => {
    expect(() => chunkAudio(new Uint8Array(641))).toThrow(expect.objectContaining({ code: 'bad_message' }));
  });

  it('returns no chunks for 20 bytes', () => {
    expect(chunkAudio(new Uint8Array(20))).toEqual([]);
  });

  it('drops a trailing chunk shorter than 640 bytes', () => {
    const pcm = new Uint8Array(2 * BYTES_PER_SECOND + 100);

    expect(chunkAudio(pcm, 1).map((chunk) => chunk.length)).toEqual([BYTES_PER_SECOND, BYTES_PER_SECOND]);
  });
});
