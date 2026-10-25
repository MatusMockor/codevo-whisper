import { describe, expect, it } from 'vitest';
import { AudioBuffer, BLOCK_BYTES } from '../src/gateway/audio-buffer';

describe('AudioBuffer', () => {
  it('keeps many small frames in a bounded number of fixed-size blocks', () => {
    const buffer = new AudioBuffer();
    for (let index = 0; index < 10_000; index += 1) {
      buffer.append(new Uint8Array(640).fill(index % 256));
    }

    expect(buffer.bytes()).toBe(6_400_000);
    expect(buffer.blockCount()).toBe(Math.ceil(6_400_000 / BLOCK_BYTES));
  });

  it('returns the exact bytes in order and empties itself', () => {
    const buffer = new AudioBuffer();
    const first = new Uint8Array(BLOCK_BYTES - 2).fill(1);
    const second = Uint8Array.of(2, 2, 3, 3, 4, 4);
    buffer.append(first);
    buffer.append(second);
    const pcm = buffer.take();

    expect(pcm.length).toBe(first.length + second.length);
    expect([...pcm.subarray(first.length - 2)]).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(buffer.bytes()).toBe(0);
    expect(buffer.blockCount()).toBe(0);
  });
});
