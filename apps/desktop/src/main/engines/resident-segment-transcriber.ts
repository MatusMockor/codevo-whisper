import type { SegmentTranscriber, TranscriptionJob } from '@codevo-whisper/audio';
import type { ResidentTranscriber, TranscribeLanguage } from '@codevo-whisper/stt-runner';

export const MIN_JOB_BYTES = 640;
export type LocalContext = { hint: TranscribeLanguage; vocabulary?: readonly string[] };

export function skippedJob(pcm: Uint8Array, signal: AbortSignal): Promise<string> | null {
  if (signal.aborted) {
    return Promise.reject(new DOMException('The dictation was cancelled', 'AbortError'));
  }
  if (pcm.byteLength < MIN_JOB_BYTES) {
    return Promise.resolve('');
  }
  return null;
}

export class ResidentSegmentTranscriber implements SegmentTranscriber<LocalContext> {
  constructor(private readonly resident: ResidentTranscriber, private readonly startup: Promise<void> = Promise.resolve()) {}

  transcribe(job: TranscriptionJob<LocalContext>, signal: AbortSignal): Promise<string> {
    const skipped = skippedJob(job.pcm, signal);
    if (skipped !== null) {
      return skipped;
    }
    return this.startup.then(() => this.resident.transcribe({ pcm: job.pcm, language: job.context.hint, ...(job.context.vocabulary === undefined ? {} : { vocabulary: job.context.vocabulary }), signal }));
  }
}
