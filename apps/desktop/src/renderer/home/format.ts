import { calendarDateToUtc, isoWeekday } from '../../shared/calendar-date';

const NUMBER = new Intl.NumberFormat('sk-SK');
const DAY_AND_MONTH = new Intl.DateTimeFormat('sk-SK', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const WEEKDAY = new Intl.DateTimeFormat('sk-SK', { weekday: 'long', timeZone: 'UTC' });
const SHORT_DAYS = ['Ne', 'Po', 'Ut', 'St', 'Št', 'Pi', 'So'] as const;

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

export function compactNumber(value: number): string {
  if (value < 1000) {
    return formatNumber(value);
  }
  return `${formatNumber(value / 1000)}k`;
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

export function dayAndMonth(date: string): string {
  return DAY_AND_MONTH.format(calendarDateToUtc(date));
}

export function numericDate(date: string): string {
  const utc = calendarDateToUtc(date);
  return `${utc.getUTCDate()}. ${utc.getUTCMonth() + 1}.`;
}

export function weekdayDate(date: string, today: string): string {
  if (date === today) {
    return `dnes, ${numericDate(date)}`;
  }
  return `${WEEKDAY.format(calendarDateToUtc(date))} ${numericDate(date)}`;
}

export function chartDayLabel(date: string, today: string, dense: boolean): string {
  if (date === today) {
    return 'dnes';
  }
  if (!dense) {
    return shortDayName(date).toLocaleLowerCase('sk-SK');
  }
  return isoWeekday(date) === 1 ? numericDate(date) : '';
}
