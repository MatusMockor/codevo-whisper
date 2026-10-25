import { calendarDateToUtc } from '../../shared/calendar-date';

const NUMBER = new Intl.NumberFormat('sk-SK');
const LONG_DAY = new Intl.DateTimeFormat('sk-SK', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const DAY_AND_MONTH = new Intl.DateTimeFormat('sk-SK', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const SHORT_DAYS = ['Ne', 'Po', 'Ut', 'St', 'Št', 'Pi', 'So'] as const;

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  if (minutes === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${minutes} min`;
}

export function dayWord(count: number): string {
  if (count === 1) {
    return 'deň';
  }
  if (count >= 2 && count <= 4) {
    return 'dni';
  }
  return 'dní';
}

export function shortDayName(date: string): string {
  return SHORT_DAYS[calendarDateToUtc(date).getUTCDay()] ?? '';
}

export function longDayName(date: string, today: string): string {
  const name = LONG_DAY.format(calendarDateToUtc(date));
  return date === today ? `dnes, ${name}` : name;
}

export function dayAndMonth(date: string): string {
  return DAY_AND_MONTH.format(calendarDateToUtc(date));
}
