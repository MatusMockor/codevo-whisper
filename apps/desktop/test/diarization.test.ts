import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseDiarization } from '../src/main/meetings/diarization';

describe('parseDiarization', () => {
  it('reads the speaker segments of real Sortformer output in time order', async () => {
    const stdout = await readFile(new URL('./fixtures/transcribe-cli-speakers.txt', import.meta.url), 'utf8');

    expect(parseDiarization(stdout)).toEqual([
      { t0Ms: 320, t1Ms: 2400, speaker: 1 },
      { t0Ms: 4240, t1Ms: 6640, speaker: 2 },
      { t0Ms: 7360, t1Ms: 9360, speaker: 1 },
      { t0Ms: 9760, t1Ms: 12_000, speaker: 2 },
      { t0Ms: 10_240, t1Ms: 10_640, speaker: 1 },
    ]);
  });

  it('returns nothing without a speaker segments block', () => {
    expect(parseDiarization('words: 1\n  [   0.32 ->    0.64] And\n')).toEqual([]);
    expect(parseDiarization('')).toEqual([]);
  });

  it('keeps times past 1000 s', () => {
    expect(parseDiarization('speaker segments: 1\n  [1234.50 -> 1240.00] S4\n')).toEqual([{ t0Ms: 1_234_500, t1Ms: 1_240_000, speaker: 4 }]);
  });
});
