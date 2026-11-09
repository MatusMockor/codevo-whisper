import { describe, expect, it } from 'vitest';
import { chartDayLabel, compactNumber, formatDuration, numericDate, weekdayDate } from '../src/renderer/home/format';

const MONDAY = '2026-11-09';

describe('home format helpers', () => {
  it('rounds durations to minutes and hours', () => {
    expect(formatDuration(1440)).toBe('24 min');
    expect(formatDuration(7560)).toBe('2 h 6 min');
    expect(formatDuration(7200)).toBe('2 h');
    expect(formatDuration(20)).toBe('0 min');
  });

  it('shortens axis numbers above a thousand with the Slovak decimal comma', () => {
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(500)).toBe('500');
    expect(compactNumber(1000)).toBe('1k');
    expect(compactNumber(1500)).toBe('1,5k');
  });

  it('formats calendar dates as day and month numbers', () => {
    expect(numericDate(MONDAY)).toBe('9. 11.');
    expect(numericDate('2026-01-31')).toBe('31. 1.');
  });

  it('names the weekday or today', () => {
    expect(weekdayDate('2026-11-05', MONDAY)).toBe('štvrtok 5. 11.');
    expect(weekdayDate(MONDAY, MONDAY)).toBe('dnes, 9. 11.');
  });

  it('labels chart days by weekday, or only Mondays in the dense range', () => {
    expect(chartDayLabel('2026-11-05', MONDAY, false)).toBe('št');
    expect(chartDayLabel(MONDAY, MONDAY, false)).toBe('dnes');
    expect(chartDayLabel('2026-11-02', MONDAY, true)).toBe('2. 11.');
    expect(chartDayLabel('2026-11-03', MONDAY, true)).toBe('');
    expect(chartDayLabel(MONDAY, MONDAY, true)).toBe('dnes');
  });
});
