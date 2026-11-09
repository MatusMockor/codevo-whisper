import { describe, expect, it } from 'vitest';
import { chartScale } from '../src/shared/stats-chart';

describe('chartScale', () => {
  it('rounds the top up to a readable step with four equal gridlines', () => {
    expect(chartScale([760, 1250, 1710, 240, 486, 1284, 0])).toMatchObject({ top: 2000, ticks: [0, 500, 1000, 1500, 2000] });
    expect(chartScale([120, 80])).toMatchObject({ top: 200, ticks: [0, 50, 100, 150, 200] });
    expect(chartScale([1000])).toMatchObject({ top: 1000, ticks: [0, 250, 500, 750, 1000] });
    expect(chartScale([12500])).toMatchObject({ top: 20000, ticks: [0, 5000, 10000, 15000, 20000] });
  });

  it('keeps a minimal scale for empty or tiny series', () => {
    expect(chartScale([0, 0, 0])).toEqual({ top: 100, ticks: [0, 25, 50, 75, 100], total: 0, average: 0 });
    expect(chartScale([])).toEqual({ top: 100, ticks: [0, 25, 50, 75, 100], total: 0, average: 0 });
    expect(chartScale([10]).top).toBe(100);
  });

  it('sums the series and rounds the daily average', () => {
    expect(chartScale([100, 0, 50])).toMatchObject({ total: 150, average: 50 });
    expect(chartScale([1, 2])).toMatchObject({ total: 3, average: 2 });
  });
});
