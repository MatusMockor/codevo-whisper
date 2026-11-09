import { describe, expect, it } from 'vitest';
import { activeRovingIndex, rovingIndex } from '../src/renderer/components/roving-index';

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

  it('keeps the focused day when the week rolls over and the days shift by seven', () => {
    const before = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
    const after = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', ...before, '2026-10-26'];

    expect(activeRovingIndex(before, '2026-10-24')).toBe(5);
    expect(activeRovingIndex(after, '2026-10-24')).toBe(12);
    expect(after[rovingIndex('ArrowUp', activeRovingIndex(after, '2026-10-24'), after.length - 1, HEATMAP_STEPS) ?? -1]).toBe('2026-10-23');
  });

  it('starts on the last day and falls back to it when the focused day is gone', () => {
    const days = ['2026-10-24', '2026-10-25'];

    expect(activeRovingIndex(days, null)).toBe(1);
    expect(activeRovingIndex(days, '2026-09-01')).toBe(1);
    expect(activeRovingIndex([], null)).toBe(-1);
  });
});
