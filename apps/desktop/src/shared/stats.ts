export type DayStats = { date: string; words: number; dictations: number; seconds: number };

export type StatsPeriod = 'today' | 'week' | 'total';

export type DayWords = { date: string; words: number };

export type StatsSummary = {
  words: number;
  dictations: number;
  seconds: number;
  wordsPerMinute: number;
  wordsPerDictation: number;
  secondsPerDictation: number;
  savedSeconds: number;
  streakDays: number;
  streakSince: string | null;
};

export type ChartScale = { top: number; ticks: number[]; total: number; average: number };

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export type HeatCell = { date: string; words: number; level: HeatLevel; today: boolean; future: boolean };
