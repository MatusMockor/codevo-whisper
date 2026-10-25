import { describe, expect, it } from 'vitest';
import { AdaptiveVad } from '../../src/vad/adaptive-vad';
import { validateVadConfig, DEFAULT_VAD_CONFIG } from '../../src/vad/vad-config';
import type { VadFrame } from '../../src/vad/vad-frame';
import { concatSamples, loadFixture } from '../support/fixtures';
import { unvoicedRuns } from '../support/runs';
import { addWhiteNoise, silence, tone } from '../support/signals';

function runVad(samples: Int16Array): VadFrame[] {
  const vad = new AdaptiveVad();
  const frames: VadFrame[] = [];
  for (let start = 0; start < samples.length; start += 1600) {
    frames.push(...vad.process(samples.subarray(start, start + 1600)));
  }
  return frames;
}

function covers(runs: { startMs: number; durationMs: number }[], ms: number): boolean {
  return runs.some((run) => run.startMs <= ms && ms <= run.startMs + run.durationMs);
}

describe('AdaptiveVad', () => {
  it('labels silence and a tone after silence', () => {
    const frames = runVad(concatSamples(silence(1000), tone(1000, 8000)));

    expect(frames.filter((frame) => frame.endSample <= 16000).every((frame) => !frame.voiced)).toBe(true);
    expect(frames.filter((frame) => frame.startSample >= 16640).every((frame) => frame.voiced)).toBe(true);
  });

  it('keeps positions across uneven chunks', () => {
    const vad = new AdaptiveVad();
    const samples = tone(200, 4000);
    const frames = [...vad.process(samples.subarray(0, 7)), ...vad.process(samples.subarray(7, 1600)), ...vad.process(samples.subarray(1600))];

    expect(frames.map((frame) => frame.startSample)).toEqual([0, 320, 640, 960, 1280, 1600, 1920, 2240, 2560, 2880]);
    expect(frames.every((frame) => frame.endSample - frame.startSample === 320)).toBe(true);
  });

  it('finds the sentence pauses of the recorded fixture', () => {
    const runs = unvoicedRuns(runVad(loadFixture('speech-pauses')), 200).filter((run) => run.startMs >= 3000);

    expect(runs).toHaveLength(2);
    expect(runs[0]?.startMs).toBeGreaterThanOrEqual(6800);
    expect(runs[0]?.startMs).toBeLessThanOrEqual(6950);
    expect(runs[1]?.startMs).toBeGreaterThanOrEqual(10100);
    expect(runs[1]?.startMs).toBeLessThanOrEqual(10250);
  });

  it('finds the sentence pauses with white noise at -30 dBFS', () => {
    const frames = runVad(addWhiteNoise(loadFixture('speech-pauses'), 1000, 7));
    const runs = unvoicedRuns(frames, 200);

    expect(covers(runs, 6950)).toBe(true);
    expect(covers(runs, 10250)).toBe(true);
    expect(unvoicedRuns(frames, 200, (frame) => frame.energyDb < -36)).toEqual([]);
  });

  it('does not report pauses while the prior floor is in effect on speech that starts mid-word', () => {
    expect(unvoicedRuns(runVad(loadFixture('speech-continuous')), 200)).toEqual([]);
  });

  it('digital silence before the speech does not change the decisions on the speech', () => {
    const noisy = addWhiteNoise(loadFixture('speech-pauses'), 150, 7);
    const plain = runVad(noisy).map((frame) => frame.voiced);
    const prefixed = runVad(concatSamples(silence(2000), noisy))
      .slice(100)
      .map((frame) => frame.voiced);

    expect(prefixed).toEqual(plain);
  });

  it('adapts to a noise step and finds the pauses after it', () => {
    const speech = loadFixture('speech-pauses');
    const stepped = concatSamples(speech.subarray(0, 48000), addWhiteNoise(speech.subarray(48000), 1000, 5));
    const runs = unvoicedRuns(runVad(stepped), 200);

    expect(covers(runs, 6950)).toBe(true);
    expect(covers(runs, 10250)).toBe(true);
  });

  it('accepts 30 ms frames', () => {
    const vad = new AdaptiveVad({ frameMs: 30 });
    expect(vad.process(tone(90, 4000)).map((frame) => frame.endSample)).toEqual([480, 960, 1440]);
  });

  it('validateVadConfig rejects frames outside 20-30 ms and inverted ratios', () => {
    expect(() => validateVadConfig({ ...DEFAULT_VAD_CONFIG, frameMs: 10 })).toThrow(RangeError);
    expect(() => validateVadConfig({ ...DEFAULT_VAD_CONFIG, releaseRatio: 0.6 })).toThrow(RangeError);
    expect(() => validateVadConfig({ ...DEFAULT_VAD_CONFIG, onsetRatio: 0 })).toThrow(RangeError);
    expect(() => validateVadConfig({ ...DEFAULT_VAD_CONFIG, silenceDb: Number.NaN })).toThrow(RangeError);
    expect(() => validateVadConfig({ ...DEFAULT_VAD_CONFIG, floorWindowMs: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });
});
