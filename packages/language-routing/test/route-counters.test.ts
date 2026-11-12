import { describe, expect, it } from 'vitest';
import { ROUTES } from '../src/route';
import { RouteCounters } from '../src/route-counters';

describe('RouteCounters', () => {
  it('starts every route at zero', () => {
    const counters = new RouteCounters();

    expect(Object.keys(counters.snapshot())).toEqual([...ROUTES]);
    expect(Object.values(counters.snapshot()).every((count) => count === 0)).toBe(true);
    expect(counters.total()).toBe(0);
  });

  it('counts each recorded route', () => {
    const counters = new RouteCounters();
    counters.record('conditioned');
    counters.record('conditioned');
    counters.record('verbatim-unsure');

    expect(counters.snapshot()).toMatchObject({ conditioned: 2, 'verbatim-unsure': 1, 'verbatim-guard': 0 });
    expect(counters.total()).toBe(3);
  });

  it('hands out snapshots that later records do not change', () => {
    const counters = new RouteCounters();
    const before = counters.snapshot();
    counters.record('auto');

    expect(before.auto).toBe(0);
    expect(Object.isFrozen(before)).toBe(true);
    expect(counters.snapshot().auto).toBe(1);
  });
});
