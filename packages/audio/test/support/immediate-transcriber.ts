import type { SegmentTranscriber } from '../../src/scheduling/segment-transcriber';
import type { TranscriptionJob } from '../../src/scheduling/transcription-job';

export class ImmediateTranscriber implements SegmentTranscriber {
  readonly lengths: number[] = [];
  readonly jobs: TranscriptionJob[] = [];

  constructor(private readonly textFor: (pcm: Uint8Array, call: number) => string = (pcm) => `dĺžka${pcm.byteLength}`) {}

  transcribe(job: TranscriptionJob): Promise<string> {
    this.jobs.push(job);
    this.lengths.push(job.pcm.byteLength);
    return Promise.resolve(this.textFor(job.pcm, this.lengths.length - 1));
  }
}
