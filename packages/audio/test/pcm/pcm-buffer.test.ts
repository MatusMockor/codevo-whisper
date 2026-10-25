import { describe, expect, it } from 'vitest';
import { PcmBuffer } from '../../src/pcm/pcm-buffer';

function rampBytes(fromSample: number, count: number): Uint8Array {
  const bytes = new Uint8Array(count * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < count; index += 1) {
    view.setInt16(index * 2, (fromSample + index) % 30000, true);
  }
  return bytes;
}

describe('PcmBuffer', () => {
  it('keeps absolute positions after discardBefore', () => {
    const buffer = new PcmBuffer();
    buffer.append(rampBytes(0, 1600));
    buffer.append(rampBytes(1600, 1600));
    buffer.append(rampBytes(3200, 1600));

    buffer.discardBefore(2000);

    expect(buffer.startSample).toBe(2000);
    expect(buffer.endSample).toBe(4800);
    expect([...buffer.slice(2000, 2002)]).toEqual([...rampBytes(2000, 2)]);
  });

  it('returns the newly completed samples from append', () => {
    const buffer = new PcmBuffer();
    buffer.append(rampBytes(0, 10));

    expect([...buffer.append(rampBytes(10, 3))]).toEqual([10, 11, 12]);
  });

  it('carries an odd byte across appends', () => {
    const buffer = new PcmBuffer();
    const bytes = rampBytes(5, 2);

    expect([...buffer.append(bytes.subarray(0, 3))]).toEqual([5]);
    expect([...buffer.append(bytes.subarray(3))]).toEqual([6]);
    expect(buffer.endSample).toBe(2);
  });

  it('slice returns a copy', () => {
    const buffer = new PcmBuffer();
    buffer.append(rampBytes(0, 4));
    const copy = buffer.slice(0, 4);

    buffer.discardBefore(4);
    buffer.append(rampBytes(100, 4));

    expect([...copy]).toEqual([...rampBytes(0, 4)]);
  });

  it('grows beyond its initial capacity', () => {
    const buffer = new PcmBuffer();
    for (let frame = 0; frame < 50; frame += 1) {
      buffer.append(rampBytes(frame * 1600, 1600));
    }

    expect(buffer.endSample).toBe(80000);
    expect([...buffer.slice(79998, 80000)]).toEqual([...rampBytes(79998, 2)]);
  });

  it('slice before startSample throws RangeError', () => {
    const buffer = new PcmBuffer();
    buffer.append(rampBytes(0, 100));
    buffer.discardBefore(50);

    expect(() => buffer.slice(10, 60)).toThrow(RangeError);
    expect(() => buffer.slice(60, 101)).toThrow(RangeError);
  });
});
