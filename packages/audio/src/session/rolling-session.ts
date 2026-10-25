import { PartialGate } from '../partials/partial-gate';
import { PcmBuffer } from '../pcm/pcm-buffer';
import { samplesToMs } from '../pcm/pcm-format';
import type { JobOutcome } from '../scheduling/job-outcome';
import type { JobKind, TranscriptionContext, TranscriptionJob } from '../scheduling/transcription-job';
import type { Segment } from '../segmentation/segment';
import { Segmenter } from '../segmentation/segmenter';
import { TranscriptAssembler } from '../transcript/transcript-assembler';
import type { TranscriptEvent } from '../transcript/transcript-event';
import { AdaptiveVad } from '../vad/adaptive-vad';
import type { VadFrame } from '../vad/vad-frame';
import type { VoiceActivityDetector } from '../vad/voice-activity-detector';
import { DEFAULT_MIN_PARTIAL_TAIL_MS, DEFAULT_MS_PER_OVERLAP_WORD, type RollingSessionOptions } from './rolling-session-options';
import { SegmentFailedError, SessionCancelledError } from './session-errors';

type SessionState = 'recording' | 'finishing' | 'done' | 'cancelled';
type Failure = { segmentId: number; error: unknown };

export class RollingSession<TContext = TranscriptionContext> {
  private readonly buffer = new PcmBuffer();
  private readonly vad: VoiceActivityDetector;
  private readonly segmenter: Segmenter;
  private readonly assembler: TranscriptAssembler;
  private readonly gate: PartialGate;
  private readonly sessionId: string;
  private readonly finals: Promise<void>[] = [];
  private state: SessionState = 'recording';
  private voicedSinceRequest = false;
  private failure: Failure | undefined;
  private rejectFinish: ((error: Error) => void) | undefined;

  constructor(private readonly options: RollingSessionOptions<TContext>) {
    this.vad = options.vad ?? new AdaptiveVad();
    this.segmenter = new Segmenter(options.segment);
    this.assembler = new TranscriptAssembler(options.msPerOverlapWord ?? DEFAULT_MS_PER_OVERLAP_WORD);
    this.gate = new PartialGate(options.clock.now(), options.minPartialTailMs ?? DEFAULT_MIN_PARTIAL_TAIL_MS);
    this.sessionId = options.registry.attach(options.deviceId, options.partials);
  }

  push(pcm: Uint8Array): void {
    if (this.state !== 'recording') {
      throw new Error(`RollingSession cannot accept audio while ${this.state}`);
    }
    for (const frame of this.vad.process(this.buffer.append(pcm))) {
      this.onFrame(frame);
    }
    this.maybeRequestPartial();
  }

  finish(): Promise<string> {
    if (this.state !== 'recording') {
      return Promise.reject(new Error(`RollingSession cannot finish while ${this.state}`));
    }
    this.state = 'finishing';
    const last = this.segmenter.finish(this.buffer.endSample);
    if (last !== undefined) {
      this.commit(last);
    }
    return new Promise<string>((resolve, reject) => {
      this.rejectFinish = reject;
      void Promise.all(this.finals).then(() => this.complete(resolve, reject));
    });
  }

  cancel(): void {
    if (this.state === 'done' || this.state === 'cancelled') {
      return;
    }
    this.state = 'cancelled';
    this.options.submitter.cancelSession(this.sessionId);
    this.options.registry.detach(this.sessionId);
    this.rejectFinish?.(new SessionCancelledError());
  }

  private onFrame(frame: VadFrame): void {
    this.voicedSinceRequest ||= frame.voiced;
    const segment = this.segmenter.onFrame(frame);
    if (segment !== undefined) {
      this.commit(segment);
    }
  }

  private commit(segment: Segment): void {
    const revision = this.assembler.commit(segment);
    if (!segment.voiced && segment.reason !== 'end') {
      this.buffer.discardBefore(this.segmenter.openStartSample);
      this.emit(this.assembler.skipFinal(segment.id));
      return;
    }
    const pcm = this.buffer.slice(segment.startSample, segment.endSample);
    this.buffer.discardBefore(this.segmenter.openStartSample);
    this.finals.push(
      this.options.submitter
        .submit(this.job('final', segment.id, revision, pcm))
        .then((outcome) => this.onFinal(segment.id, outcome))
        .catch((error: unknown) => this.recordFailure(segment.id, error)),
    );
  }

  private onFinal(segmentId: number, outcome: JobOutcome): void {
    if (this.state === 'cancelled') {
      return;
    }
    if (outcome.status === 'done') {
      this.emit(this.assembler.acceptFinal(segmentId, outcome.text));
      return;
    }
    if (outcome.status === 'failed') {
      this.recordFailure(segmentId, outcome.error);
    }
    if (outcome.status === 'dropped') {
      this.recordFailure(segmentId, new Error(`Final of segment ${segmentId} was dropped: ${outcome.reason}`));
    }
    this.emit(this.assembler.skipFinal(segmentId));
  }

  private maybeRequestPartial(): void {
    if (!this.options.partials) {
      return;
    }
    const now = this.options.clock.now();
    const start = this.segmenter.openStartSample;
    const tailMs = samplesToMs(this.buffer.endSample - start);
    if (!this.gate.isDue(now, this.options.interval.partialIntervalMs(), tailMs, this.voicedSinceRequest)) {
      return;
    }
    this.gate.markRequested(now);
    this.voicedSinceRequest = false;
    const segmentId = this.segmenter.openSegmentId;
    const leadInSamples = this.segmenter.openLeadInSamples;
    const revision = this.assembler.nextPartialRevision(segmentId);
    const pcm = this.buffer.slice(start, this.buffer.endSample);
    void this.options.submitter
      .submit(this.job('partial', segmentId, revision, pcm))
      .then((outcome) => this.onPartial(segmentId, revision, leadInSamples, outcome))
      .catch((error: unknown) => this.recordFailure(segmentId, error));
  }

  private onPartial(segmentId: number, revision: number, leadInSamples: number, outcome: JobOutcome): void {
    if (this.state === 'cancelled' || outcome.status !== 'done') {
      return;
    }
    const event = this.assembler.acceptPartial(segmentId, revision, outcome.text, leadInSamples);
    if (event !== undefined) {
      this.emit([event]);
    }
  }

  private recordFailure(segmentId: number, error: unknown): void {
    this.failure ??= { segmentId, error };
  }

  private complete(resolve: (text: string) => void, reject: (error: Error) => void): void {
    if (this.state === 'cancelled') {
      return;
    }
    this.state = 'done';
    this.options.registry.detach(this.sessionId);
    if (this.failure !== undefined) {
      reject(new SegmentFailedError(this.failure.segmentId, this.assembler.text(), { cause: this.failure.error }));
      return;
    }
    resolve(this.assembler.text());
  }

  private job(kind: JobKind, segmentId: number, revision: number, pcm: Uint8Array): TranscriptionJob<TContext> {
    return { sessionId: this.sessionId, deviceId: this.options.deviceId, kind, segmentId, revision, pcm, context: this.options.context };
  }

  private emit(events: TranscriptEvent[]): void {
    events.forEach((event) => this.options.onEvent(event));
  }
}
