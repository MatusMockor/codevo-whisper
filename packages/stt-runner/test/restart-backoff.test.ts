import { describe, expect, it } from 'vitest';
import { RestartBackoff } from '../src/worker/restart-backoff';

describe('RestartBackoff', () => {
  it('doubles the delay per failure up to the maximum', () => {
    const backoff = new RestartBackoff({ initialMs: 100, maxMs: 300 });

    expect(backoff.delayMs()).toBe(0);
    backoff.recordFailure();
    expect(backoff.delayMs()).toBe(100);
    backoff.recordFailure();
    expect(backoff.delayMs()).toBe(200);
    backoff.recordFailure();
    expect(backoff.delayMs()).toBe(300);
  });

  it('returns to the initial delay after a reset', () => {
    const backoff = new RestartBackoff({ initialMs: 100, maxMs: 1_000 });
    backoff.recordFailure();
    backoff.recordFailure();

    backoff.reset();
    expect(backoff.delayMs()).toBe(0);
    backoff.recordFailure();
    expect(backoff.delayMs()).toBe(100);
  });
});
