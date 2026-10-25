import { describe, expect, it } from 'vitest';
import { PauseTracker } from '../../src/segmentation/pause-tracker';
import { at, buildFrames } from '../support/frames';

function observeAll(tracker: PauseTracker, frames: ReturnType<typeof buildFrames>): (ReturnType<PauseTracker['observe']>)[] {
  return frames.map((frame) => tracker.observe(frame));
}

describe('PauseTracker', () => {
  it('reports a pause when speech resumes after >= 200 ms', () => {
    const tracker = new PauseTracker(at(0.2));
    const ended = observeAll(tracker, buildFrames([[true, 1000], [false, 240], [true, 100]])).filter((pause) => pause !== undefined);

    expect(ended).toEqual([{ startSample: at(1), endSample: at(1.24) }]);
  });

  it('ignores a 180 ms dip', () => {
    const tracker = new PauseTracker(at(0.2));
    const ended = observeAll(tracker, buildFrames([[true, 1000], [false, 180], [true, 100]])).filter((pause) => pause !== undefined);

    expect(ended).toEqual([]);
    expect(tracker.candidates(0)).toEqual([]);
  });

  it('ongoing returns the current run once it reaches the minimum', () => {
    const tracker = new PauseTracker(at(0.2));
    observeAll(tracker, buildFrames([[true, 1000], [false, 180]]));
    expect(tracker.ongoing()).toBeUndefined();

    observeAll(tracker, buildFrames([[false, 20]]).map((frame) => ({ ...frame, startSample: frame.startSample + at(1.18), endSample: frame.endSample + at(1.18) })));
    expect(tracker.ongoing()).toEqual({ startSample: at(1), endSample: at(1.2) });
    expect(tracker.silentSamples).toBe(at(0.2));
  });

  it('candidates filters by midpoint and includes the ongoing pause', () => {
    const tracker = new PauseTracker(at(0.2));
    observeAll(tracker, buildFrames([[true, 1000], [false, 400], [true, 1000], [false, 300]]));

    expect(tracker.candidates(at(1.3))).toEqual([{ startSample: at(2.4), endSample: at(2.7) }]);
    expect(tracker.candidates(at(1.1))).toHaveLength(2);
  });

  it('prune forgets pauses that ended before a sample', () => {
    const tracker = new PauseTracker(at(0.2));
    observeAll(tracker, buildFrames([[true, 1000], [false, 400], [true, 1000]]));
    tracker.prune(at(1.5));

    expect(tracker.candidates(0)).toEqual([]);
  });
});
