import { describe, expect, it } from 'vitest';
import { rovingIndex } from '../src/renderer/components/roving-index';

const HEATMAP_STEPS = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };

describe('rovingIndex', () => {
  it('moves by day vertically and by week horizontally through the heatmap', () => {
    expect(rovingIndex('ArrowDown', 3, 37, HEATMAP_STEPS)).toBe(4);
    expect(rovingIndex('ArrowUp', 3, 37, HEATMAP_STEPS)).toBe(2);
    expect(rovingIndex('ArrowRight', 3, 37, HEATMAP_STEPS)).toBe(10);
    expect(rovingIndex('ArrowLeft', 10, 37, HEATMAP_STEPS)).toBe(3);
  });

  it('stays within the past days and jumps to the first and last day', () => {
    expect(rovingIndex('ArrowRight', 35, 37, HEATMAP_STEPS)).toBe(37);
    expect(rovingIndex('ArrowLeft', 4, 37, HEATMAP_STEPS)).toBe(0);
    expect(rovingIndex('Home', 20, 37, HEATMAP_STEPS)).toBe(0);
    expect(rovingIndex('End', 2, 37, HEATMAP_STEPS)).toBe(37);
  });

  it('ignores keys without a step', () => {
    expect(rovingIndex('Enter', 5, 37, HEATMAP_STEPS)).toBeNull();
    expect(rovingIndex('ArrowUp', 5, 37, { ArrowLeft: -1, ArrowRight: 1 })).toBeNull();
  });
});
