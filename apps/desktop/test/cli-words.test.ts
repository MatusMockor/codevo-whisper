import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseCliWords } from '../src/main/meetings/cli-words';

describe('parseCliWords', () => {
  it('reads the words block of real transcribe-cli output', async () => {
    const stdout = await readFile(new URL('./fixtures/transcribe-cli-words.txt', import.meta.url), 'utf8');

    const words = parseCliWords(stdout);

    expect(words).toHaveLength(10);
    expect(words[0]).toEqual({ t0Ms: 320, t1Ms: 640, text: 'And' });
    expect(words[9]).toEqual({ t0Ms: 8640, t1Ms: 9360, text: 'Americans' });
    expect(words.map((word) => word.text).join(' ')).toBe('And so, my fellow Americans And so my fellow Americans');
  });

  it('ignores segment lines and returns nothing without a words block', () => {
    expect(parseCliWords('segments: 1\n  [   0.32 ->    9.36] And so\n')).toEqual([]);
    expect(parseCliWords('')).toEqual([]);
  });

  it('keeps times past 1000 s and skips blank words', () => {
    expect(parseCliWords('words: 2\n  [1234.50 -> 1235.01] dlhé\n  [1235.10 -> 1235.20] \n')).toEqual([{ t0Ms: 1_234_500, t1Ms: 1_235_010, text: 'dlhé' }]);
  });
});
