import { describe, expect, it } from 'vitest';
import { contains, exceedsThreshold, insertionIndex, regionAt, DRAG_THRESHOLD_PX } from '../src/renderer/components/pointer-drag';
import { acceptsDrop, languageDropPlan } from '../src/renderer/settings/language-drop';

const ROWS = [
  { left: 0, top: 0, right: 300, bottom: 40 },
  { left: 0, top: 46, right: 300, bottom: 86 },
  { left: 0, top: 92, right: 300, bottom: 132 },
];

describe('pointer drag geometry', () => {
  it('starts a drag only after the pointer moved past the threshold so a click stays a click', () => {
    expect(DRAG_THRESHOLD_PX).toBe(4);
    expect(exceedsThreshold({ x: 10, y: 10 }, { x: 12, y: 12 })).toBe(false);
    expect(exceedsThreshold({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(true);
    expect(exceedsThreshold({ x: 10, y: 10 }, { x: 10, y: 3 })).toBe(true);
  });

  it('finds the insertion index from the row midpoints', () => {
    expect(insertionIndex(ROWS, -5)).toBe(0);
    expect(insertionIndex(ROWS, 19)).toBe(0);
    expect(insertionIndex(ROWS, 21)).toBe(1);
    expect(insertionIndex(ROWS, 70)).toBe(2);
    expect(insertionIndex(ROWS, 120)).toBe(3);
    expect(insertionIndex(ROWS, 400)).toBe(3);
    expect(insertionIndex([], 10)).toBe(0);
  });

  it('hits the zone under the pointer and nothing outside', () => {
    const regions = [
      { id: 'used', box: { left: 0, top: 0, right: 300, bottom: 200 } },
      { id: 'available', box: { left: 0, top: 212, right: 300, bottom: 400 } },
      { id: 'gone', box: null },
    ];

    expect(contains({ left: 0, top: 0, right: 10, bottom: 10 }, { x: 10, y: 10 })).toBe(true);
    expect(regionAt({ x: 150, y: 100 }, regions)).toBe('used');
    expect(regionAt({ x: 150, y: 300 }, regions)).toBe('available');
    expect(regionAt({ x: 150, y: 205 }, regions)).toBeNull();
    expect(regionAt({ x: 350, y: 100 }, regions)).toBeNull();
  });
});

describe('languageDropPlan', () => {
  it('moves a used row, adds a chip at the pointed position and removes a row dropped on the other languages', () => {
    expect(languageDropPlan({ code: 'sk', from: 'used' }, { zone: 'used', index: 2 })).toEqual({ kind: 'move', at: 2 });
    expect(languageDropPlan({ code: 'de', from: 'available' }, { zone: 'used', index: 0 })).toEqual({ kind: 'add', at: 0 });
    expect(languageDropPlan({ code: 'sk', from: 'used' }, { zone: 'available', index: 1 })).toEqual({ kind: 'remove' });
  });

  it('ignores a chip dropped back on its zone and anything dropped outside the zones', () => {
    expect(languageDropPlan({ code: 'de', from: 'available' }, { zone: 'available', index: 0 })).toEqual({ kind: 'none' });
    expect(languageDropPlan({ code: 'sk', from: 'used' }, { zone: null, index: 0 })).toEqual({ kind: 'none' });
    expect(acceptsDrop({ code: 'de', from: 'available' }, 'available')).toBe(false);
    expect(acceptsDrop({ code: 'sk', from: 'used' }, 'available')).toBe(true);
    expect(acceptsDrop({ code: 'de', from: 'available' }, 'used')).toBe(true);
  });
});
