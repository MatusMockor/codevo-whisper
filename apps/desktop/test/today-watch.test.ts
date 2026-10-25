import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchToday } from '../src/renderer/home/today-watch';

class WakeSource {
  readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  wake(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('watchToday', () => {
  it('announces the new day at every local midnight', () => {
    vi.setSystemTime(new Date('2026-10-25T23:59:00'));
    const days: string[] = [];
    const stop = watchToday((today) => days.push(today), { onWake: new WakeSource().subscribe });

    vi.advanceTimersByTime(59_000);
    expect(days).toEqual([]);
    vi.advanceTimersByTime(2_000);
    expect(days).toEqual(['2026-10-26']);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(days).toEqual(['2026-10-26', '2026-10-27']);
    stop();
  });

  it('rechecks the date when the window wakes up', () => {
    vi.setSystemTime(new Date('2026-10-25T22:00:00'));
    const wake = new WakeSource();
    const days: string[] = [];
    const stop = watchToday((today) => days.push(today), { onWake: wake.subscribe });

    wake.wake();
    expect(days).toEqual([]);
    vi.setSystemTime(new Date('2026-10-26T09:30:00'));
    wake.wake();
    wake.wake();
    expect(days).toEqual(['2026-10-26']);
    stop();
  });

  it('stopping clears the midnight timer and the wake subscription', () => {
    vi.setSystemTime(new Date('2026-10-25T12:00:00'));
    const wake = new WakeSource();

    const stop = watchToday(() => undefined, { onWake: wake.subscribe });
    expect(vi.getTimerCount()).toBe(1);
    stop();

    expect(vi.getTimerCount()).toBe(0);
    expect(wake.listeners.size).toBe(0);
  });
});
