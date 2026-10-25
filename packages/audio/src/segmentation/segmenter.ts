import { msToSamples } from '../pcm/pcm-format';
import type { VadFrame } from '../vad/vad-frame';
import { PauseTracker } from './pause-tracker';
import type { CutReason, Segment } from './segment';
import { DEFAULT_SEGMENT_CONFIG, validateSegmentConfig, type SegmentConfig } from './segment-config';
import { selectCut } from './select-cut';

const MIN_SEGMENT_SAMPLES = msToSamples(20);

type Limits = {
  target: number;
  hard: number;
  minSegment: number;
  pauseLeadIn: number;
  hardLeadIn: number;
  settledPause: number;
};

export class Segmenter {
  private readonly limits: Limits;
  private readonly pauses: PauseTracker;
  private start = 0;
  private leadIn = 0;
  private id = 0;
  private lastCut: CutReason | undefined;
  private lastVoicedStart: number | undefined;
  private firstVoicedInSegment: number | undefined;

  constructor(config: Partial<SegmentConfig> = {}) {
    const valid = validateSegmentConfig({ ...DEFAULT_SEGMENT_CONFIG, ...config });
    this.limits = {
      target: msToSamples(valid.targetMs),
      hard: msToSamples(valid.hardMs),
      minSegment: msToSamples(valid.minSegmentMs),
      pauseLeadIn: msToSamples(valid.preRollMs),
      hardLeadIn: msToSamples(Math.max(valid.overlapMs, valid.preRollMs)),
      settledPause: msToSamples(valid.settledPauseMs),
    };
    this.pauses = new PauseTracker(msToSamples(valid.minPauseMs));
  }

  get openSegmentId(): number {
    return this.id;
  }

  get openStartSample(): number {
    return this.start;
  }

  get openLeadInSamples(): number {
    return this.leadIn;
  }

  onFrame(frame: VadFrame): Segment | undefined {
    this.trackVoice(frame);
    const endedPause = this.pauses.observe(frame);
    const tail = frame.endSample - this.start;
    if (tail >= this.limits.hard) {
      return this.cutAtLimit(frame.endSample);
    }
    if (tail < this.limits.target) {
      return undefined;
    }
    if (endedPause === undefined && this.pauses.silentSamples < this.limits.settledPause) {
      return undefined;
    }
    const cut = this.bestPause();
    return cut === undefined ? undefined : this.cut(cut, 'pause');
  }

  finish(endSample: number): Segment | undefined {
    if (endSample - this.start < MIN_SEGMENT_SAMPLES) {
      return undefined;
    }
    if (this.lastCut !== undefined && this.lastCut !== 'hard' && !this.isVoicedBefore(endSample)) {
      return undefined;
    }
    return this.cut(endSample, 'end');
  }

  private trackVoice(frame: VadFrame): void {
    if (!frame.voiced) {
      return;
    }
    this.lastVoicedStart = frame.startSample;
    this.firstVoicedInSegment ??= frame.startSample;
  }

  private cutAtLimit(endSample: number): Segment {
    const cut = this.bestPause();
    if (cut === undefined) {
      return this.cut(endSample, 'hard');
    }
    return this.cut(cut, 'pause');
  }

  private bestPause(): number | undefined {
    return selectCut(this.pauses.candidates(this.start + this.limits.minSegment));
  }

  private isVoicedBefore(sample: number): boolean {
    return this.firstVoicedInSegment !== undefined && this.firstVoicedInSegment < sample;
  }

  private cut(endSample: number, reason: CutReason): Segment {
    const segment: Segment = {
      id: this.id,
      startSample: this.start,
      endSample,
      leadInSamples: this.leadIn,
      reason,
      voiced: this.isVoicedBefore(endSample),
    };
    this.leadIn = reason === 'pause' ? this.limits.pauseLeadIn : this.limits.hardLeadIn;
    this.start = endSample - this.leadIn;
    this.id += 1;
    this.lastCut = reason;
    this.firstVoicedInSegment = this.lastVoicedStart !== undefined && this.lastVoicedStart >= endSample ? this.lastVoicedStart : undefined;
    this.pauses.prune(this.start);
    return segment;
  }
}
