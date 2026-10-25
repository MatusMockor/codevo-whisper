import { localDate } from '../../shared/calendar-date';

const MIDNIGHT_MARGIN_MS = 250;

export type WakeSubscription = (listener: () => void) => () => void;

export type TodayWatchDeps = { onWake: WakeSubscription; clock?: () => Date };

function msUntilNextMidnight(now: Date): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return midnight.getTime() - now.getTime();
}

export function watchToday(onDay: (today: string) => void, { onWake, clock = () => new Date() }: TodayWatchDeps): () => void {
  let current = localDate(clock());
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(check, msUntilNextMidnight(clock()) + MIDNIGHT_MARGIN_MS);
  };

  function check(): void {
    schedule();
    const next = localDate(clock());
    if (next === current) {
      return;
    }
    current = next;
    onDay(next);
  }

  schedule();
  const unsubscribe = onWake(check);
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
