import { msToSamples } from '../../src/pcm/pcm-format';
import type { VadFrame } from '../../src/vad/vad-frame';

export type Stretch = [voiced: boolean, ms: number];

export function buildFrames(stretches: Stretch[], frameMs = 20): VadFrame[] {
  const frameSamples = msToSamples(frameMs);
  const frames: VadFrame[] = [];
  let position = 0;
  for (const [voiced, ms] of stretches) {
    const count = Math.round(ms / frameMs);
    for (let index = 0; index < count; index += 1) {
      frames.push({ startSample: position, endSample: position + frameSamples, energyDb: voiced ? -20 : -60, voiced });
      position += frameSamples;
    }
  }
  return frames;
}

export function at(seconds: number): number {
  return msToSamples(seconds * 1000);
}
