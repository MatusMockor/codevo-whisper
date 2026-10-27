import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_TIMING, UpdateScheduler } from '../src/main/updates/update-scheduler';
import { RecordingLogger } from './recording-logger';

const FIRST_MS = 15_000;

const FOUR_MINUTES_MS = 4 * 60 * 1000;

function counting(outcome: () => Promise<void> = () => Promise.resolve()) {
  const logger = new RecordingLogger();
  let checks = 0;
  const scheduler = new UpdateScheduler(() => {
    checks += 1;
    return outcome();
  }, logger);
  return { scheduler, logger, checks: () => checks };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('UpdateScheduler', () => {
  it('uses the timing of a first check after 15 seconds and then every 4 minutes', () => {
    expect(UPDATE_TIMING).toEqual({ initialDelayMs: FIRST_MS, intervalMs: FOUR_MINUTES_MS });
  });

  it('checks 15 seconds after the start and then every 4 minutes', async () => {
    const { scheduler, checks } = counting();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(FIRST_MS - 1);
    expect(checks()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(checks()).toBe(1);
    await vi.advanceTimersByTimeAsync(FOUR_MINUTES_MS - 1);
    expect(checks()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(checks()).toBe(2);
    await vi.advanceTimersByTimeAsync(FOUR_MINUTES_MS);
    expect(checks()).toBe(3);
    scheduler.dispose();
  });

  it('stops checking after dispose before the first check', async () => {
    const { scheduler, checks } = counting();

    scheduler.start();
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(FOUR_MINUTES_MS * 2);

    expect(checks()).toBe(0);
  });

  it('stops checking after dispose between checks', async () => {
    const { scheduler, checks } = counting();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(FIRST_MS);
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(FOUR_MINUTES_MS * 2);

    expect(checks()).toBe(1);
  });

  it('keeps the schedule and logs when a check rejects', async () => {
    const { scheduler, checks, logger } = counting(() => Promise.reject(new Error('offline')));

    scheduler.start();
    await vi.advanceTimersByTimeAsync(FIRST_MS + FOUR_MINUTES_MS);

    expect(checks()).toBe(2);
    expect(logger.errors.map((entry) => entry.message)).toEqual(['The scheduled update check failed', 'The scheduled update check failed']);
    scheduler.dispose();
  });

  it('starts only once', async () => {
    const { scheduler, checks } = counting();

    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(FIRST_MS);

    expect(checks()).toBe(1);
    scheduler.dispose();
  });
});
