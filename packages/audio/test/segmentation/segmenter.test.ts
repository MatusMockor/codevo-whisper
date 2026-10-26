import { describe, expect, it } from 'vitest';
import { msToSamples } from '../../src/pcm/pcm-format';
import { validateSegmentConfig, DEFAULT_SEGMENT_CONFIG } from '../../src/segmentation/segment-config';
import type { Segment } from '../../src/segmentation/segment';
import { Segmenter } from '../../src/segmentation/segmenter';
import { AdaptiveVad } from '../../src/vad/adaptive-vad';
import type { VadFrame } from '../../src/vad/vad-frame';
import { concatSamples, loadFixture } from '../support/fixtures';
import { at, buildFrames, type Stretch } from '../support/frames';
import { unvoicedRuns } from '../support/runs';

function segmentFrames(frames: VadFrame[], segmenter = new Segmenter()): Segment[] {
  return frames.map((frame) => segmenter.onFrame(frame)).filter((segment) => segment !== undefined);
}

function run(stretches: Stretch[]): { segments: Segment[]; segmenter: Segmenter; end: number } {
  const segmenter = new Segmenter();
  const frames = buildFrames(stretches);
  return { segments: segmentFrames(frames, segmenter), segmenter, end: frames.at(-1)?.endSample ?? 0 };
}

function vadFrames(samples: Int16Array): VadFrame[] {
  const vad = new AdaptiveVad();
  const frames: VadFrame[] = [];
  for (let start = 0; start < samples.length; start += 1600) {
    frames.push(...vad.process(samples.subarray(start, start + 1600)));
  }
  return frames;
}

describe('Segmenter', () => {
  it('does not cut before the target even after a long pause', () => {
    expect(run([[true, 12000], [false, 1000], [true, 1000]]).segments).toEqual([]);
  });

  it('cuts at the longest pause once a pause ends after the target', () => {
    const { segments, segmenter } = run([[true, 11000], [false, 300], [true, 4700], [false, 220], [true, 500]]);

    expect(segments).toEqual([{ id: 0, startSample: 0, endSample: at(11.15), leadInSamples: 0, reason: 'pause', voiced: true, followsVoicedHardCut: false }]);
    expect(segmenter.openStartSample).toBe(at(10.65));
    expect(segmenter.openSegmentId).toBe(1);
    expect(segmenter.openLeadInSamples).toBe(at(0.5));
  });

  it('never lets a hard segment exceed 25 s when the segment does not start on a frame boundary', () => {
    const { segments } = run([[true, 11000], [false, 300], [true, 4700], [true, 25000]]);

    expect(segments[0]?.endSample).toBe(at(11.15));
    expect(segments[1]).toMatchObject({ startSample: at(10.65), endSample: at(35.65), reason: 'hard' });
  });

  it('cuts on a settled 500 ms silence without waiting for speech', () => {
    const { segments } = run([[true, 15500], [false, 500]]);

    expect(segments).toEqual([{ id: 0, startSample: 0, endSample: at(15.75), leadInSamples: 0, reason: 'pause', voiced: true, followsVoicedHardCut: false }]);
  });

  it('commits a silence that was already settled when the target is reached', () => {
    const { segments } = run([[true, 14000], [false, 1100]]);

    expect(segments[0]?.endSample).toBe(at(14.5));
  });

  it('ignores pauses shorter than 200 ms after the target', () => {
    expect(run([[true, 15200], [false, 180], [true, 2000]]).segments).toEqual([]);
  });

  it('hard cut at 25 s with 1 s overlap when no pause qualifies', () => {
    const segmenter = new Segmenter();
    const segments = segmentFrames(buildFrames([[true, 30000]]), segmenter);
    const last = segmenter.finish(at(30));

    expect(segments).toEqual([{ id: 0, startSample: 0, endSample: at(25), leadInSamples: 0, reason: 'hard', voiced: true, followsVoicedHardCut: false }]);
    expect(last).toEqual({ id: 1, startSample: at(24), endSample: at(30), leadInSamples: at(1), reason: 'end', voiced: true, followsVoicedHardCut: true });
  });

  it('at the hard limit cuts at an earlier candidate pause instead of mid-word', () => {
    const { segments } = run([[true, 12000], [false, 200], [true, 13000]]);

    expect(segments[0]).toMatchObject({ endSample: at(12.1), reason: 'pause' });
  });

  it('does not use a pause before the minimum segment length', () => {
    const { segments } = run([[true, 5000], [false, 600], [true, 20000]]);

    expect(segments[0]).toMatchObject({ endSample: at(25), reason: 'hard' });
  });

  it('finish emits the remaining tail as an end segment', () => {
    const { segmenter } = run([[true, 3000]]);

    expect(segmenter.finish(at(3.01))).toEqual({ id: 0, startSample: 0, endSample: at(3.01), leadInSamples: 0, reason: 'end', voiced: true, followsVoicedHardCut: false });
  });

  it('finish skips the end segment when nothing was voiced after a cut', () => {
    const { segments, segmenter, end } = run([[true, 15500], [false, 1500]]);

    expect(segments).toHaveLength(1);
    expect(segmenter.finish(end)).toBeUndefined();
  });

  it('finish always emits the end segment after a hard cut so the overlap is re-read', () => {
    const segmenter = new Segmenter();
    segmentFrames(buildFrames([[true, 24900], [false, 1000]]), segmenter);

    expect(segmenter.finish(at(25.9))).toMatchObject({ id: 1, startSample: at(24), reason: 'end', voiced: false });
  });

  it('finish skips the silent end after a hard cut of silence', () => {
    const segmenter = new Segmenter();
    const segments = segmentFrames(buildFrames([[true, 5000], [false, 55000]]), segmenter);

    expect(segments.some((segment) => segment.reason === 'hard' && !segment.voiced)).toBe(true);
    expect(segmenter.finish(at(60))).toBeUndefined();
  });

  it('marks the segment after a voiced hard cut so it re-reads the overlap', () => {
    const segmenter = new Segmenter();
    const segments = segmentFrames(buildFrames([[true, 25000], [false, 40000]]), segmenter);

    expect(segments.map((segment) => [segment.reason, segment.voiced, segment.followsVoicedHardCut])).toEqual([
      ['hard', true, false],
      ['pause', false, true],
      ['hard', false, false],
    ]);
  });

  it('marks a later segment without voiced audio as unvoiced', () => {
    const { segments } = run([[true, 15500], [false, 26000]]);

    expect(segments.map((segment) => segment.voiced)).toEqual([true, false]);
  });

  it('finish always emits the only segment even if unvoiced', () => {
    const { segmenter, end } = run([[false, 2000]]);

    expect(segmenter.finish(end)).toMatchObject({ id: 0, reason: 'end', voiced: false });
  });

  it('finish emits nothing for less than 20 ms of audio', () => {
    expect(new Segmenter().finish(100)).toBeUndefined();
  });

  it('segment ids increase from 0 and segments chain through their lead-in', () => {
    const segmenter = new Segmenter();
    const segments = [...segmentFrames(buildFrames([[true, 60000]]), segmenter), segmenter.finish(at(60))].filter((segment) => segment !== undefined);

    expect(segments.map((segment) => segment.id)).toEqual([0, 1, 2]);
    segments.slice(1).forEach((segment, index) => {
      expect(segment.startSample).toBe((segments[index]?.endSample ?? 0) - segment.leadInSamples);
    });
  });

  it('three pause fixtures in a row commit at a pause between 10 and 25 s', () => {
    const frames = vadFrames(concatSamples(loadFixture('speech-pauses'), loadFixture('speech-pauses'), loadFixture('speech-pauses')));
    const pauses = unvoicedRuns(frames, 200);
    const segmenter = new Segmenter();
    const segments = [...segmentFrames(frames, segmenter), segmenter.finish(frames.at(-1)?.endSample ?? 0)].filter((segment) => segment !== undefined);
    const first = segments[0];

    expect(first?.reason).toBe('pause');
    expect((first?.endSample ?? 0) - (first?.startSample ?? 0)).toBeGreaterThanOrEqual(msToSamples(10000));
    expect(pauses.some((pause) => msToSamples(pause.startMs) <= (first?.endSample ?? 0) && (first?.endSample ?? 0) <= msToSamples(pause.startMs + pause.durationMs))).toBe(true);
    expect(segments.at(-1)?.reason).toBe('end');
    expect(segments.every((segment) => segment.endSample - segment.startSample <= msToSamples(25000))).toBe(true);
  });

  it('continuous speech only hard cuts and no job exceeds 25 s', () => {
    const continuous = loadFixture('speech-continuous');
    const frames = vadFrames(concatSamples(continuous, continuous, continuous));
    const segmenter = new Segmenter();
    const segments = [...segmentFrames(frames, segmenter), segmenter.finish(frames.at(-1)?.endSample ?? 0)].filter((segment) => segment !== undefined);

    expect(segments.map((segment) => segment.reason)).toEqual(['hard', 'end']);
    expect(segments.every((segment) => segment.endSample - segment.startSample <= msToSamples(25000))).toBe(true);
    expect(segments[1]?.leadInSamples).toBe(msToSamples(1000));
  });

  it('validateSegmentConfig rejects inconsistent limits', () => {
    expect(() => validateSegmentConfig({ ...DEFAULT_SEGMENT_CONFIG, hardMs: 15000 })).toThrow(RangeError);
    expect(() => validateSegmentConfig({ ...DEFAULT_SEGMENT_CONFIG, minSegmentMs: 16000 })).toThrow(RangeError);
    expect(() => validateSegmentConfig({ ...DEFAULT_SEGMENT_CONFIG, overlapMs: 10000 })).toThrow(RangeError);
    expect(() => validateSegmentConfig({ ...DEFAULT_SEGMENT_CONFIG, settledPauseMs: 100 })).toThrow(RangeError);
    expect(() => validateSegmentConfig({ ...DEFAULT_SEGMENT_CONFIG, overlapMs: -100 })).toThrow(RangeError);
    expect(() => validateSegmentConfig({ ...DEFAULT_SEGMENT_CONFIG, overlapMs: 0, preRollMs: 0 })).toThrow(RangeError);
    expect(validateSegmentConfig({ ...DEFAULT_SEGMENT_CONFIG, overlapMs: 0, preRollMs: 20 }).overlapMs).toBe(0);
    expect(() => validateSegmentConfig({ ...DEFAULT_SEGMENT_CONFIG, preRollMs: Number.NaN })).toThrow(RangeError);
    expect(() => validateSegmentConfig({ ...DEFAULT_SEGMENT_CONFIG, targetMs: Number.NaN })).toThrow(RangeError);
  });
});
