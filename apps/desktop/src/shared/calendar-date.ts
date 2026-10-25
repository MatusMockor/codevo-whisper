const DAY_MS = 86_400_000;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function calendarDateToUtc(date: string): Date {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function localDate(moment: Date): string {
  return `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`;
}

export function addDays(date: string, days: number): string {
  return fromUtc(new Date(calendarDateToUtc(date).getTime() + days * DAY_MS));
}

export function isoWeekday(date: string): number {
  return calendarDateToUtc(date).getUTCDay() || 7;
}

export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}
