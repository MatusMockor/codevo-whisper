import { describe, expect, it } from 'vitest';
import type { DayStats } from '../src/shared/stats';
import { summarize } from '../src/shared/stats-summary';

const SUNDAY = '2026-10-25';

function day(date: string, words: number, dictations = 1, seconds = 60): DayStats {
  return { date, words, dictations, seconds };
}

const DAYS: DayStats[] = [
  day('2026-10-10', 1000, 10, 600),
  day('2026-10-18', 200, 2, 120),
  day('2026-10-19', 100, 1, 60),
  day('2026-10-22', 50, 2, 30),
  day(SUNDAY, 80, 4, 48),
];

describe('summarize', () => {
  it('today, week from Monday, total', () => {
    expect(summarize(DAYS, 'today', SUNDAY)).toMatchObject({ words: 80, dictations: 4, seconds: 48 });
    expect(summarize(DAYS, 'week', SUNDAY)).toMatchObject({ words: 230, dictations: 7, seconds: 138 });
    expect(summarize(DAYS, 'total', SUNDAY)).toMatchObject({ words: 1430, dictations: 19, seconds: 858 });
    expect(summarize(DAYS, 'week', '2026-10-19')).toMatchObject({ words: 100, dictations: 1, seconds: 60 });
    expect(summarize([], 'today', SUNDAY)).toMatchObject({ words: 0, dictations: 0, seconds: 0, wordsPerMinute: 0, savedSeconds: 0 });
  });

  it('words per minute from recorded seconds', () => {
    expect(summarize([day(SUNDAY, 150, 3, 60)], 'today', SUNDAY).wordsPerMinute).toBe(150);
    expect(summarize([day(SUNDAY, 100, 1, 45)], 'today', SUNDAY).wordsPerMinute).toBe(133);
    expect(summarize([day(SUNDAY, 10, 1, 0)], 'today', SUNDAY).wordsPerMinute).toBe(0);
  });

  it('saved time uses 40 words per minute and never goes negative', () => {
    expect(summarize([day(SUNDAY, 400, 2, 120)], 'today', SUNDAY).savedSeconds).toBe(480);
    expect(summarize([day(SUNDAY, 20, 1, 60)], 'today', SUNDAY).savedSeconds).toBe(0);
  });

  it('streak counts consecutive days and tolerates no dictation yet today', () => {
    const run = [day('2026-10-21', 5), day('2026-10-22', 5), day('2026-10-23', 5), day('2026-10-24', 5)];

    expect(summarize(run, 'today', SUNDAY)).toMatchObject({ streakDays: 4, streakSince: '2026-10-21' });
    expect(summarize([...run, day(SUNDAY, 5)], 'today', SUNDAY)).toMatchObject({ streakDays: 5, streakSince: '2026-10-21' });
    expect(summarize([day('2026-10-20', 5), day('2026-10-22', 5), day(SUNDAY, 5)], 'today', SUNDAY)).toMatchObject({ streakDays: 1, streakSince: SUNDAY });
    expect(summarize([day('2026-10-23', 5)], 'today', SUNDAY)).toMatchObject({ streakDays: 0, streakSince: null });
    expect(summarize([day('2026-10-24', 0, 0, 0), day(SUNDAY, 0, 0, 0)], 'today', SUNDAY)).toMatchObject({ streakDays: 0, streakSince: null });
    expect(summarize([day('2026-10-31', 5), day('2026-11-01', 5)], 'today', '2026-11-01')).toMatchObject({ streakDays: 2, streakSince: '2026-10-31' });
  });

  it('last7 fills missing days with 0', () => {
    expect(summarize(DAYS, 'total', SUNDAY).last7).toEqual([
      { date: '2026-10-19', words: 100 },
      { date: '2026-10-20', words: 0 },
      { date: '2026-10-21', words: 0 },
      { date: '2026-10-22', words: 50 },
      { date: '2026-10-23', words: 0 },
      { date: '2026-10-24', words: 0 },
      { date: SUNDAY, words: 80 },
    ]);
    expect(summarize([], 'today', '2026-03-02').last7.map((entry) => entry.date)).toEqual([
      '2026-02-24',
      '2026-02-25',
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });
});
