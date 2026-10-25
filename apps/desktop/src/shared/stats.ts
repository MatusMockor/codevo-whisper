export type DayStats = { date: string; words: number; dictations: number; seconds: number };

export type StatsPeriod = 'today' | 'week' | 'total';

export type DayWords = { date: string; words: number };

export type StatsSummary = {
  words: number;
  dictations: number;
  seconds: number;
  wordsPerMinute: number;
  savedSeconds: number;
  streakDays: number;
  streakSince: string | null;
  last7: DayWords[];
};
