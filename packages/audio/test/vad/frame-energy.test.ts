import { describe, expect, it } from 'vitest';
import { frameEnergyDb } from '../../src/vad/frame-energy';

describe('frameEnergyDb', () => {
  it('is about 0 dB for a full-scale square wave', () => {
    const square = Int16Array.from({ length: 320 }, (_, index) => (index % 2 === 0 ? 32767 : -32768));
    expect(frameEnergyDb(square, 0, 320, -100)).toBeCloseTo(0, 1);
  });

  it('is silenceDb for digital silence', () => {
    expect(frameEnergyDb(new Int16Array(320), 0, 320, -100)).toBe(-100);
  });

  it('measures only the given range', () => {
    const samples = new Int16Array(640);
    samples.fill(16384, 320);
    expect(frameEnergyDb(samples, 320, 640, -100)).toBeCloseTo(-6.02, 1);
  });
});
