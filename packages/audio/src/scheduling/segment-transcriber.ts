import type { TranscriptionContext, TranscriptionJob } from './transcription-job';

export interface SegmentTranscriber<TContext = TranscriptionContext> {
  transcribe(job: TranscriptionJob<TContext>, signal: AbortSignal): Promise<string>;
}
