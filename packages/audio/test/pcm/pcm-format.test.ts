import { describe, expect, it } from 'vitest';
import { decodePcm16le, msToSamples, samplesToMs } from '../../src/pcm/pcm-format';

describe('pcm format', () => {
  it('decodePcm16le decodes little-endian samples', () => {
    expect([...decodePcm16le(new Uint8Array([0x01, 0x00, 0xff, 0xff, 0x00, 0x80]))]).toEqual([1, -1, -32768]);
  });

  it('decodePcm16le ignores a trailing odd byte', () => {
    expect([...decodePcm16le(new Uint8Array([0x02, 0x00, 0x05]))]).toEqual([2]);
  });

  it('decodePcm16le reads from an unaligned view', () => {
    const backing = new Uint8Array([9, 0x03, 0x00, 0x04, 0x00]);
    expect([...decodePcm16le(backing.subarray(1))]).toEqual([3, 4]);
  });

  it('converts between milliseconds and samples at 16 kHz', () => {
    expect(msToSamples(20)).toBe(320);
    expect(samplesToMs(16000)).toBe(1000);
  });
});
