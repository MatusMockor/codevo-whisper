import { removeBoundaryDuplicates } from '../dedup/remove-boundary-duplicates';
import { samplesToMs } from '../pcm/pcm-format';
import type { Segment } from '../segmentation/segment';
import type { TranscriptEvent } from './transcript-event';

type SegmentState = {
  issuedRevision: number;
  emittedRevision: number;
  committed: boolean;
  leadInSamples: number;
};

export class TranscriptAssembler {
  private readonly segments = new Map<number, SegmentState>();
  private readonly arrivedFinals = new Map<number, string>();
  private readonly released: string[] = [];
  private committedCount = 0;

  constructor(private readonly msPerOverlapWord = 250) {}

  get pendingFinals(): number {
    return this.committedCount - this.released.length;
  }

  nextPartialRevision(segmentId: number): number {
    const state = this.state(segmentId);
    state.issuedRevision += 1;
    return state.issuedRevision;
  }

  commit(segment: Segment): number {
    const state = this.state(segment.id);
    state.committed = true;
    state.leadInSamples = segment.leadInSamples;
    state.issuedRevision += 1;
    this.committedCount += 1;
    return state.issuedRevision;
  }

  acceptPartial(segmentId: number, revision: number, text: string, leadInSamples: number): TranscriptEvent | undefined {
    const state = this.state(segmentId);
    if (state.committed || revision <= state.emittedRevision) {
      return undefined;
    }
    state.emittedRevision = revision;
    const deduped = this.released.length === segmentId ? this.dedup(text, leadInSamples) : text.trim();
    return { type: 'partial', segmentId, revision, text: deduped };
  }

  acceptFinal(segmentId: number, text: string): TranscriptEvent[] {
    this.arrivedFinals.set(segmentId, text);
    return this.release();
  }

  skipFinal(segmentId: number): TranscriptEvent[] {
    return this.acceptFinal(segmentId, '');
  }

  text(): string {
    return this.released.filter((text) => text.length > 0).join(' ');
  }

  private release(): TranscriptEvent[] {
    const events: TranscriptEvent[] = [];
    let segmentId = this.released.length;
    let raw = this.arrivedFinals.get(segmentId);
    while (raw !== undefined) {
      const state = this.state(segmentId);
      const text = this.dedup(raw, state.leadInSamples);
      this.arrivedFinals.delete(segmentId);
      this.released.push(text);
      events.push({ type: 'final', segmentId, revision: state.issuedRevision, text });
      segmentId += 1;
      raw = this.arrivedFinals.get(segmentId);
    }
    return events;
  }

  private dedup(text: string, leadInSamples: number): string {
    const previous = this.released.findLast((released) => released.length > 0) ?? '';
    return removeBoundaryDuplicates(previous, text, Math.ceil(samplesToMs(leadInSamples) / this.msPerOverlapWord));
  }

  private state(segmentId: number): SegmentState {
    const existing = this.segments.get(segmentId);
    if (existing !== undefined) {
      return existing;
    }
    const created = { issuedRevision: 0, emittedRevision: 0, committed: false, leadInSamples: 0 };
    this.segments.set(segmentId, created);
    return created;
  }
}
