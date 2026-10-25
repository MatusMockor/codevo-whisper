import type { VadFrame } from '../vad/vad-frame';
import { pauseLength, pauseMidpoint, type Pause } from './pause';

export class PauseTracker {
  private ended: Pause[] = [];
  private run: Pause | undefined;

  constructor(private readonly minPauseSamples: number) {}

  get silentSamples(): number {
    return this.run === undefined ? 0 : pauseLength(this.run);
  }

  observe(frame: VadFrame): Pause | undefined {
    if (!frame.voiced) {
      this.run = { startSample: this.run?.startSample ?? frame.startSample, endSample: frame.endSample };
      return undefined;
    }
    const finished = this.ongoing();
    this.run = undefined;
    if (finished === undefined) {
      return undefined;
    }
    this.ended.push(finished);
    return finished;
  }

  ongoing(): Pause | undefined {
    if (this.run === undefined || pauseLength(this.run) < this.minPauseSamples) {
      return undefined;
    }
    return { ...this.run };
  }

  candidates(fromSample: number): Pause[] {
    const ongoing = this.ongoing();
    const all = ongoing === undefined ? this.ended : [...this.ended, ongoing];
    return all.filter((pause) => pauseMidpoint(pause) >= fromSample);
  }

  prune(beforeSample: number): void {
    this.ended = this.ended.filter((pause) => pause.endSample > beforeSample);
  }
}
