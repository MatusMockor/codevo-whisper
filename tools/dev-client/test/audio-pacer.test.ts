import { describe, expect, it } from 'vitest';
import { pacedFrames } from '../src/audio-pacer';

const MS = 32;

describe('pacedFrames', () => {
  it('sends live audio in real time from the first frame', () => {
    const frames = pacedFrames(new Uint8Array(350 * MS), { frameMs: 100, burstSeconds: 0 });

    expect(frames.map((frame) => frame.atMs)).toEqual([0, 100, 200, 300]);
    expect(frames.map((frame) => frame.pcm.length)).toEqual([3200, 3200, 3200, 1600]);
  });

  it('sends the burst at once and the rest in real time', () => {
    const frames = pacedFrames(new Uint8Array(500 * MS), { frameMs: 100, burstSeconds: 0.2 });

    expect(frames.map((frame) => frame.atMs)).toEqual([0, 0, 0, 100, 200]);
  });

  it('returns no frames for empty audio', () => {
    expect(pacedFrames(new Uint8Array(0), { frameMs: 100, burstSeconds: 0 })).toEqual([]);
  });
});
