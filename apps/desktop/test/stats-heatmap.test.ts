import { describe, expect, it } from 'vitest';
import type { DayStats } from '../src/shared/stats';
import { activityWeeks, HEATMAP_WEEKS } from '../src/shared/stats-heatmap';

const MONDAY = '2026-11-09';
const WEDNESDAY = '2026-11-11';

function day(date: string, words: number): DayStats {
  return { date, words, dictations: 1, seconds: 60 };
}

describe('activityWeeks', () => {
  it('lays out Monday-first weeks ending with the current week', () => {
    const weeks = activityWeeks([], MONDAY);

    expect(weeks).toHaveLength(HEATMAP_WEEKS);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0]?.[0]?.date).toBe('2026-10-05');
    expect(weeks[5]?.[0]).toMatchObject({ date: MONDAY, today: true, future: false });
    expect(weeks[5]?.slice(1).every((cell) => cell.future && cell.level === 0)).toBe(true);
  });

  it('scales intensity against the busiest past day in the grid', () => {
    const weeks = activityWeeks([day('2026-11-02', 1000), day('2026-11-03', 500), day('2026-11-04', 1), day('2026-11-05', 760), day(WEDNESDAY, 260)], WEDNESDAY);
    const lastTwo = [...(weeks[4] ?? []), ...(weeks[5] ?? [])];
    const level = (date: string) => lastTwo.find((cell) => cell.date === date)?.level;

    expect(level('2026-11-02')).toBe(4);
    expect(level('2026-11-05')).toBe(4);
    expect(level('2026-11-03')).toBe(2);
    expect(level('2026-11-04')).toBe(1);
    expect(level(WEDNESDAY)).toBe(2);
    expect(level('2026-11-06')).toBe(0);
  });

  it('ignores days outside the grid and never leaks future data', () => {
    const weeks = activityWeeks([day('2026-01-01', 9999), day('2026-11-12', 5000), day(WEDNESDAY, 10)], WEDNESDAY);
    const cells = weeks.flat();

    expect(cells.find((cell) => cell.date === WEDNESDAY)).toMatchObject({ words: 10, level: 4, today: true });
    expect(cells.find((cell) => cell.date === '2026-11-12')).toMatchObject({ words: 0, level: 0, future: true });
  });

  it('supports a custom number of weeks', () => {
    expect(activityWeeks([], '2026-11-15', 2).flat().map((cell) => cell.date)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ]);
  });
});
