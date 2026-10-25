import { describe, expect, it } from 'vitest';
import { PreAuthLimiter } from '../src/gateway/pre-auth-limiter';

const LIMITS = { maxPendingTotal: 64, maxPendingPerIp: 4 } as const;

describe('PreAuthLimiter', () => {
  it('enforces the per-IP pending limit', () => {
    const limiter = new PreAuthLimiter(LIMITS);
    const results = Array.from({ length: 5 }, () => limiter.tryAcquire('10.0.0.1'));

    expect(results).toEqual([true, true, true, true, false]);
    expect(limiter.tryAcquire('10.0.0.2')).toBe(true);
  });

  it('enforces the global pending limit', () => {
    const limiter = new PreAuthLimiter(LIMITS);
    const results = Array.from({ length: 65 }, (_, index) => limiter.tryAcquire(`10.0.${Math.floor(index / 4)}.${index % 4}`));

    expect(results.filter(Boolean)).toHaveLength(64);
    expect(results.at(-1)).toBe(false);
    expect(limiter.pending()).toBe(64);
  });

  it('promote frees the pending slot', () => {
    const limiter = new PreAuthLimiter(LIMITS);
    Array.from({ length: 4 }, () => limiter.tryAcquire('10.0.0.1'));
    limiter.promote('10.0.0.1');

    expect(limiter.pending()).toBe(3);
    expect(limiter.tryAcquire('10.0.0.1')).toBe(true);
    expect(limiter.tryAcquire('10.0.0.1')).toBe(false);
  });

  it('does not count authenticated connections against the per-IP limit', () => {
    const limiter = new PreAuthLimiter(LIMITS);
    Array.from({ length: 20 }, () => {
      expect(limiter.tryAcquire('10.0.0.1')).toBe(true);
      limiter.promote('10.0.0.1');
    });

    expect(limiter.pending()).toBe(0);
    limiter.release('10.0.0.1', true);
    expect(limiter.pending()).toBe(0);
  });

  it('release frees slots', () => {
    const limiter = new PreAuthLimiter(LIMITS);
    Array.from({ length: 4 }, () => limiter.tryAcquire('10.0.0.1'));
    Array.from({ length: 4 }, () => limiter.release('10.0.0.1', false));

    expect(limiter.pending()).toBe(0);
    expect(Array.from({ length: 4 }, () => limiter.tryAcquire('10.0.0.1'))).toEqual([true, true, true, true]);
  });
});
