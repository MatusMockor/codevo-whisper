import { describe, expect, it } from 'vitest';
import { concatPcm, downsampleFloat32, encodePcm16le, pcmDurationMs, PCM_BYTES_PER_SECOND } from '../src/shared/pcm';

describe('downsampleFloat32', () => {
  it('downsamples 48 kHz to 16 kHz with the right length', () => {
    expect(downsampleFloat32(new Float32Array(4800), 48_000)).toHaveLength(1600);
    expect(downsampleFloat32(new Float32Array(4410), 44_100)).toHaveLength(1600);
  });

  it('averages each window of input samples', () => {
    const output = downsampleFloat32(Float32Array.from([0.5, 0.5, 0.5, -0.5, -0.5, -0.5]), 48_000);

    expect(Array.from(output)).toEqual([16384, -16384]);
  });

  it('keeps 16 kHz input as is and clips out-of-range samples', () => {
    const output = downsampleFloat32(Float32Array.from([0, 1, -1, 2, -2]), 16_000);

    expect(Array.from(output)).toEqual([0, 32767, -32768, 32767, -32768]);
  });

  it('returns no samples for empty input', () => {
    expect(downsampleFloat32(new Float32Array(0), 48_000)).toHaveLength(0);
  });
});

describe('pcmDurationMs', () => {
  it('pcmDurationMs of 32000 bytes is 1000', () => {
    expect(PCM_BYTES_PER_SECOND).toBe(32_000);
    expect(pcmDurationMs(new Uint8Array(32_000))).toBe(1000);
    expect(pcmDurationMs(new Uint8Array(3200))).toBe(100);
  });
});

describe('concatPcm', () => {
  it('joins frames in order', () => {
    const joined = concatPcm([Uint8Array.from([1, 2]), new Uint8Array(0), Uint8Array.from([3, 4, 5, 6])]);

    expect(Array.from(joined)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('returns an empty buffer for no frames', () => {
    expect(concatPcm([])).toHaveLength(0);
  });
});

describe('encodePcm16le', () => {
  it('writes samples as little-endian 16-bit bytes', () => {
    const bytes = encodePcm16le(Int16Array.from([1, -2, 0x1234]));

    expect(Array.from(bytes)).toEqual([0x01, 0x00, 0xfe, 0xff, 0x34, 0x12]);
  });
});
