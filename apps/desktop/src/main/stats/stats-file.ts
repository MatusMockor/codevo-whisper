import type { DayStats } from '../../shared/stats';

export const STATS_FILE_VERSION = 1;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type StatsFile = { version: number; days: DayStats[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function toDay(value: unknown): DayStats | null {
  if (!isRecord(value)) {
    return null;
  }
  const { date, words, dictations, seconds } = value;
  if (typeof date !== 'string' || !DATE_PATTERN.test(date) || !isCount(words) || !isCount(dictations) || !isSeconds(seconds)) {
    return null;
  }
  return { date, words, dictations, seconds };
}

export function parseStatsFile(text: string): DayStats[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed['version'] !== STATS_FILE_VERSION || !Array.isArray(parsed['days'])) {
    return null;
  }
  const days = parsed['days'].map(toDay);
  if (days.some((day) => day === null)) {
    return null;
  }
  return days.filter((day): day is DayStats => day !== null);
}

export function serializeStatsFile(days: readonly DayStats[]): string {
  const file: StatsFile = { version: STATS_FILE_VERSION, days: days.map(({ date, words, dictations, seconds }) => ({ date, words, dictations, seconds })) };
  return `${JSON.stringify(file, null, 2)}\n`;
}
