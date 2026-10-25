import { describe, expect, it } from 'vitest';
import { IngestionLimiter } from '../src/gateway/ingestion-limiter';
import { INGESTION_LIMITS } from '../src/gateway/limits';

const SECOND = 32_000;

function setup(): { limiter: IngestionLimiter; advance: (ms: number) => void } {
  let now = 1_000_000;
  return {
    limiter: new IngestionLimiter(() => now, INGESTION_LIMITS),
    advance: (ms) => {
      now += ms;
    },
  };
}

describe('IngestionLimiter', () => {
  it('uses a 180 s burst refilled at 1.25 x real time with flow marks at 30 s and 60 s', () => {
    expect(INGESTION_LIMITS).toEqual({ burstSeconds: 180, realTimeFactor: 1.25, pauseBelowSeconds: 30, resumeAboveSeconds: 60 });
  });

  it('allows exactly the burst on a frozen clock', () => {
    const { limiter } = setup();

    expect(limiter.take('a', 180 * SECOND)).toBe(true);
    expect(limiter.availableSeconds('a')).toBe(0);
    expect(limiter.take('a', 2)).toBe(false);
  });

  it('does not consume anything when a take is refused', () => {
    const { limiter } = setup();
    limiter.take('a', 170 * SECOND);

    expect(limiter.take('a', 20 * SECOND)).toBe(false);
    expect(limiter.availableSeconds('a')).toBe(10);
  });

  it('refills at 1.25 x real time', () => {
    const { limiter, advance } = setup();
    limiter.take('a', 180 * SECOND);
    advance(10_000);

    expect(limiter.availableSeconds('a')).toBe(12.5);
    expect(limiter.take('a', 12.5 * SECOND)).toBe(true);
    expect(limiter.take('a', 2)).toBe(false);
  });

  it('keeps devices independent', () => {
    const { limiter } = setup();
    limiter.take('a', 180 * SECOND);

    expect(limiter.take('b', 180 * SECOND)).toBe(true);
  });

  it('never grows above the burst', () => {
    const { limiter, advance } = setup();
    limiter.take('a', 10 * SECOND);
    advance(3_600_000);

    expect(limiter.availableSeconds('a')).toBe(180);
    expect(limiter.take('a', 180 * SECOND + 2)).toBe(false);
  });
});
