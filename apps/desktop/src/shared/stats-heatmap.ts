import { addDays, weekStart } from './calendar-date';
import type { DayStats, HeatCell, HeatLevel } from './stats';

export const HEATMAP_WEEKS = 6;

const DAYS_IN_WEEK = 7;

const LEVELS: readonly HeatLevel[] = [1, 2, 3, 4];

function heatLevel(words: number, max: number): HeatLevel {
  if (words <= 0 || max <= 0) {
    return 0;
  }
  return LEVELS[Math.ceil((words / max) * LEVELS.length) - 1] ?? 4;
}

function heatCell(date: string, words: number, max: number, today: string): HeatCell {
  if (date > today) {
    return { date, words: 0, level: 0, today: false, future: true };
  }
  return { date, words, level: heatLevel(words, max), today: date === today, future: false };
}

export function activityWeeks(days: readonly DayStats[], today: string, weeks: number = HEATMAP_WEEKS): HeatCell[][] {
  const words = new Map(days.map((day) => [day.date, day.words]));
  const first = addDays(weekStart(today), -DAYS_IN_WEEK * (weeks - 1));
  const dates = Array.from({ length: weeks * DAYS_IN_WEEK }, (_unused, index) => addDays(first, index));
  const max = Math.max(0, ...dates.filter((date) => date <= today).map((date) => words.get(date) ?? 0));
  return Array.from({ length: weeks }, (_unused, week) =>
    dates.slice(week * DAYS_IN_WEEK, (week + 1) * DAYS_IN_WEEK).map((date) => heatCell(date, words.get(date) ?? 0, max, today)),
  );
}
