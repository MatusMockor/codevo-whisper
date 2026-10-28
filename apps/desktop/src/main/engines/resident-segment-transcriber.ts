import type { SegmentTranscriber, TranscriptionJob } from '@codevo-whisper/audio';
import type { ResidentTranscriber } from '@codevo-whisper/stt-runner';
import type { Language } from '../../shared/settings';

export const MIN_JOB_BYTES = 640;
export type LocalContext = { language: Language };

export class ResidentSegmentTranscriber implements SegmentTranscriber<LocalContext> {
  constructor(private readonly resident: ResidentTranscriber, private readonly startup: Promise<void> = Promise.resolve()) {}

  transcribe(job: TranscriptionJob<LocalContext>, signal: AbortSignal): Promise<string> {
    if (signal.aborted) {
      return Promise.reject(new DOMException('The dictation was cancelled', 'AbortError'));
    }
    if (job.pcm.byteLength < MIN_JOB_BYTES) {
      return Promise.resolve('');
    }
    return this.startup.then(() => this.resident.transcribe({ pcm: job.pcm, language: job.context.language, signal }));
  }
}
