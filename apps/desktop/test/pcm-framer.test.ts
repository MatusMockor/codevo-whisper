import { describe, expect, it } from 'vitest';
import { PcmFramer } from '../src/shared/pcm-framer';

function collect(inputRate: number, emitFrames: boolean): { framer: PcmFramer; frames: Uint8Array[]; levels: number[] } {
  const frames: Uint8Array[] = [];
  const levels: number[] = [];
  const framer = new PcmFramer(inputRate, emitFrames, {
    frame: (pcm) => frames.push(pcm),
    level: (rms) => levels.push(rms),
  });
  return { framer, frames, levels };
}

function pushBlocks(framer: PcmFramer, totalSamples: number, value: number): void {
  for (let sent = 0; sent < totalSamples; sent += 128) {
    framer.push(new Float32Array(Math.min(128, totalSamples - sent)).fill(value));
  }
}

describe('PcmFramer', () => {
  it('emits 100 ms frames of 16 kHz PCM16 from 48 kHz render quanta', () => {
    const { framer, frames } = collect(48_000, true);

    pushBlocks(framer, 48_000, 0.25);

    expect(frames).toHaveLength(10);
    expect(frames.every((frame) => frame.byteLength === 3200)).toBe(true);
  });

  it('flushes the partial frame on demand', () => {
    const { framer, frames } = collect(48_000, true);

    pushBlocks(framer, 4800 + 960, 0.25);
    const rest = framer.flush();

    expect(frames).toHaveLength(1);
    expect(rest.byteLength).toBe(640);
    expect(framer.flush().byteLength).toBe(0);
  });

  it('reports the RMS level every 50 ms', () => {
    const { framer, levels } = collect(48_000, true);

    pushBlocks(framer, 4800, 0.5);

    expect(levels).toHaveLength(2);
    expect(levels[0]).toBeCloseTo(0.5, 5);
  });

  it('only reports levels in meter mode', () => {
    const { framer, frames, levels } = collect(48_000, false);

    pushBlocks(framer, 9600, 0.1);

    expect(frames).toHaveLength(0);
    expect(levels).toHaveLength(4);
    expect(framer.flush().byteLength).toBe(0);
  });
});
