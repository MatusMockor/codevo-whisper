import { describe, expect, it } from 'vitest';
import { countWords } from '../src/main/stats/count-words';

describe('countWords', () => {
  it('counts whitespace separated tokens that contain a letter or digit', () => {
    expect(countWords('Ahoj Peter, pozrel som si to.')).toBe(6);
    expect(countWords('  čo  \n  je   nové \t 2026 ')).toBe(4);
    expect(countWords('a - b … ? 3')).toBe(3);
    expect(countWords('')).toBe(0);
    expect(countWords(' - , . ')).toBe(0);
  });
});
