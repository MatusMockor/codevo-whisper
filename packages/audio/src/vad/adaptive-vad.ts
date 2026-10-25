import { msToSamples } from '../pcm/pcm-format';
import { frameEnergyDb } from './frame-energy';
import { SlidingExtremum } from './sliding-extremum';
import { DEFAULT_VAD_CONFIG, validateVadConfig, type VadConfig } from './vad-config';
import type { VadFrame } from './vad-frame';
import type { VoiceActivityDetector } from './voice-activity-detector';

export class AdaptiveVad implements VoiceActivityDetector {
  private readonly config: VadConfig;
  private readonly frameSamples: number;
  private readonly floor: SlidingExtremum;
  private readonly peak: SlidingExtremum;
  private remainder = new Int16Array(0);
  private position = 0;
  private voiced = false;

  constructor(config: Partial<VadConfig> = {}) {
    this.config = validateVadConfig({ ...DEFAULT_VAD_CONFIG, ...config });
    this.frameSamples = msToSamples(this.config.frameMs);
    const windowFrames = Math.round(this.config.floorWindowMs / this.config.frameMs);
    this.floor = new SlidingExtremum(windowFrames, (candidate, existing) => candidate <= existing);
    this.peak = new SlidingExtremum(windowFrames, (candidate, existing) => candidate >= existing);
    this.floor.push(this.config.priorFloorDb);
    this.peak.push(this.config.priorFloorDb);
  }

  process(samples: Int16Array): VadFrame[] {
    const pending = this.join(samples);
    const frames: VadFrame[] = [];
    let offset = 0;
    for (; offset + this.frameSamples <= pending.length; offset += this.frameSamples) {
      frames.push(this.classify(pending, offset));
    }
    this.remainder = pending.slice(offset);
    return frames;
  }

  private classify(samples: Int16Array, offset: number): VadFrame {
    const energyDb = frameEnergyDb(samples, offset, offset + this.frameSamples, this.config.silenceDb);
    this.floor.push(energyDb);
    this.peak.push(energyDb);
    this.voiced = energyDb >= this.threshold();
    const frame = { startSample: this.position, endSample: this.position + this.frameSamples, energyDb, voiced: this.voiced };
    this.position += this.frameSamples;
    return frame;
  }

  private threshold(): number {
    const floor = this.floor.value;
    const range = Math.max(0, this.peak.value - floor);
    if (this.voiced) {
      return floor + Math.max(this.config.minReleaseMarginDb, this.config.releaseRatio * range);
    }
    return floor + Math.max(this.config.minOnsetMarginDb, this.config.onsetRatio * range);
  }

  private join(samples: Int16Array): Int16Array {
    if (this.remainder.length === 0) {
      return samples;
    }
    const joined = new Int16Array(this.remainder.length + samples.length);
    joined.set(this.remainder);
    joined.set(samples, this.remainder.length);
    return joined;
  }
}
