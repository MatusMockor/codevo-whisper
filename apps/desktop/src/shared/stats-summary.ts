import { addDays, weekStart } from './calendar-date';
import type { DayStats, DayWords, StatsPeriod, StatsSummary } from './stats';

export const TYPING_WORDS_PER_MINUTE = 40;

const CHART_DAYS = 7;

type Totals = Pick<DayStats, 'words' | 'dictations' | 'seconds'>;

type Streak = Pick<StatsSummary, 'streakDays' | 'streakSince'>;

function firstDay(period: StatsPeriod, today: string): string {
  if (period === 'today') {
    return today;
  }
  if (period === 'week') {
    return weekStart(today);
  }
  return '';
}

function totals(days: readonly DayStats[], from: string, today: string): Totals {
  return days
    .filter((day) => day.date >= from && day.date <= today)
    .reduce<Totals>((sum, day) => ({ words: sum.words + day.words, dictations: sum.dictations + day.dictations, seconds: sum.seconds + day.seconds }), {
      words: 0,
      dictations: 0,
      seconds: 0,
    });
}

function wordsPerMinute({ words, seconds }: Totals): number {
  if (seconds <= 0) {
    return 0;
  }
  return Math.round(words / (seconds / 60));
}

function savedSeconds({ words, seconds }: Totals): number {
  return Math.max(0, Math.round((words / TYPING_WORDS_PER_MINUTE) * 60 - seconds));
}

function streak(active: ReadonlySet<string>, today: string): Streak {
  let day = active.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (active.has(day)) {
    count += 1;
    day = addDays(day, -1);
  }
  if (count === 0) {
    return { streakDays: 0, streakSince: null };
  }
  return { streakDays: count, streakSince: addDays(day, 1) };
}

function lastWeek(days: readonly DayStats[], today: string): DayWords[] {
  const words = new Map(days.map((day) => [day.date, day.words]));
  return Array.from({ length: CHART_DAYS }, (_unused, index) => {
    const date = addDays(today, index - CHART_DAYS + 1);
    return { date, words: words.get(date) ?? 0 };
  });
}

export function summarize(days: readonly DayStats[], period: StatsPeriod, today: string): StatsSummary {
  const sum = totals(days, firstDay(period, today), today);
  const active = new Set(days.filter((day) => day.dictations > 0).map((day) => day.date));
  return {
    ...sum,
    wordsPerMinute: wordsPerMinute(sum),
    savedSeconds: savedSeconds(sum),
    ...streak(active, today),
    last7: lastWeek(days, today),
  };
}
