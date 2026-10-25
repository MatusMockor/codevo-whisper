import { describe, expect, it } from 'vitest';
import { SlidingExtremum } from '../../src/vad/sliding-extremum';

describe('SlidingExtremum', () => {
  it('tracks the minimum over the last N values', () => {
    const minimum = new SlidingExtremum(3, (a, b) => a <= b);
    const seen = [5, 3, 4, 6, 7].map((value) => {
      minimum.push(value);
      return minimum.value;
    });
    expect(seen).toEqual([5, 3, 3, 3, 4]);
  });

  it('tracks the maximum over the last N values', () => {
    const maximum = new SlidingExtremum(2, (a, b) => a >= b);
    const seen = [1, 9, 2, 3, 1].map((value) => {
      maximum.push(value);
      return maximum.value;
    });
    expect(seen).toEqual([1, 9, 9, 3, 3]);
  });
});
