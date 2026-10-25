import { describe, expect, it } from 'vitest';
import { DEFAULT_PARTIAL_CONFIG, validatePartialConfig } from '../../src/partials/partial-config';
import { partialIntervalMs } from '../../src/partials/partial-interval';

describe('partialIntervalMs', () => {
  it('is 1 s with one device', () => {
    expect(partialIntervalMs(1, undefined, DEFAULT_PARTIAL_CONFIG)).toBe(1000);
  });

  it('is 2 s with two devices', () => {
    expect(partialIntervalMs(2, 500, DEFAULT_PARTIAL_CONFIG)).toBe(2000);
  });

  it('is clamped to 3 s with five devices', () => {
    expect(partialIntervalMs(5, undefined, DEFAULT_PARTIAL_CONFIG)).toBe(3000);
  });

  it('a slow engine stretches the interval', () => {
    expect(partialIntervalMs(1, 1100, DEFAULT_PARTIAL_CONFIG)).toBe(2000);
  });

  it('a fast engine never goes below the minimum', () => {
    expect(partialIntervalMs(1, 50, { ...DEFAULT_PARTIAL_CONFIG, baseIntervalMs: 200 })).toBe(1000);
  });

  it('zero devices count as one', () => {
    expect(partialIntervalMs(0, undefined, DEFAULT_PARTIAL_CONFIG)).toBe(1000);
  });

  it('validatePartialConfig rejects an inverted clamp and a load outside (0, 1]', () => {
    expect(() => validatePartialConfig({ ...DEFAULT_PARTIAL_CONFIG, minIntervalMs: 4000 })).toThrow(RangeError);
    expect(() => validatePartialConfig({ ...DEFAULT_PARTIAL_CONFIG, targetLoad: 0 })).toThrow(RangeError);
  });
});
