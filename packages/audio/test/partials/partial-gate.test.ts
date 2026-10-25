import { describe, expect, it } from 'vitest';
import { PartialGate } from '../../src/partials/partial-gate';

describe('PartialGate', () => {
  it('is not due before the interval', () => {
    expect(new PartialGate(0, 500).isDue(999, 1000, 2000, true)).toBe(false);
  });

  it('is due one interval after the start', () => {
    expect(new PartialGate(0, 500).isDue(1000, 1000, 2000, true)).toBe(true);
  });

  it('is not due with less than 0.5 s of tail', () => {
    expect(new PartialGate(0, 500).isDue(5000, 1000, 499, true)).toBe(false);
  });

  it('is not due without new voiced audio', () => {
    expect(new PartialGate(0, 500).isDue(5000, 1000, 2000, false)).toBe(false);
  });

  it('is due again one interval after markRequested', () => {
    const gate = new PartialGate(0, 500);
    gate.markRequested(1000);

    expect(gate.isDue(1999, 1000, 2000, true)).toBe(false);
    expect(gate.isDue(2000, 1000, 2000, true)).toBe(true);
  });
});
