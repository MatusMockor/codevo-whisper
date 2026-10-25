import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateScheduler } from '../src/main/updates/update-scheduler';
import { RecordingLogger } from './recording-logger';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

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
  it('checks 30 seconds after the start and then every 6 hours', async () => {
    const { scheduler, checks } = counting();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(checks()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(checks()).toBe(1);
    await vi.advanceTimersByTimeAsync(SIX_HOURS_MS - 1);
    expect(checks()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(checks()).toBe(2);
    await vi.advanceTimersByTimeAsync(SIX_HOURS_MS);
    expect(checks()).toBe(3);
    scheduler.dispose();
  });

  it('stops checking after dispose before the first check', async () => {
    const { scheduler, checks } = counting();

    scheduler.start();
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(SIX_HOURS_MS * 2);

    expect(checks()).toBe(0);
  });

  it('stops checking after dispose between checks', async () => {
    const { scheduler, checks } = counting();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(SIX_HOURS_MS * 2);

    expect(checks()).toBe(1);
  });

  it('keeps the schedule and logs when a check rejects', async () => {
    const { scheduler, checks, logger } = counting(() => Promise.reject(new Error('offline')));

    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000 + SIX_HOURS_MS);

    expect(checks()).toBe(2);
    expect(logger.errors.map((entry) => entry.message)).toEqual(['The scheduled update check failed', 'The scheduled update check failed']);
    scheduler.dispose();
  });

  it('starts only once', async () => {
    const { scheduler, checks } = counting();

    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(checks()).toBe(1);
    scheduler.dispose();
  });
});
