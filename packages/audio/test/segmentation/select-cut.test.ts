import { describe, expect, it } from 'vitest';
import { selectCut } from '../../src/segmentation/select-cut';

describe('selectCut', () => {
  it('picks the longest pause midpoint', () => {
    expect(selectCut([{ startSample: 100, endSample: 200 }, { startSample: 300, endSample: 600 }, { startSample: 700, endSample: 900 }])).toBe(450);
  });

  it('prefers the later pause on a tie', () => {
    expect(selectCut([{ startSample: 100, endSample: 200 }, { startSample: 500, endSample: 600 }])).toBe(550);
  });

  it('returns undefined without candidates', () => {
    expect(selectCut([])).toBeUndefined();
  });
});
