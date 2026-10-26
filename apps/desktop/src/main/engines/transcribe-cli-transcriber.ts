import type { SegmentTranscriber, TranscriptionJob } from '@codevo-whisper/audio';
import { runTranscribeCli, type TranscribeBackend } from '@codevo-whisper/stt-runner';
import type { Language } from '../../shared/settings';

export const MIN_JOB_BYTES = 640;

export type LocalContext = { language: Language; model: string };

export type TranscribeCliTranscriberDeps = { binary: string; backend: TranscribeBackend; threads: number; timeoutMs: number };

export class TranscribeCliTranscriber implements SegmentTranscriber<LocalContext> {
  constructor(private readonly deps: TranscribeCliTranscriberDeps) {}

  transcribe(job: TranscriptionJob<LocalContext>, signal: AbortSignal): Promise<string> {
    if (signal.aborted) {
      return Promise.reject(signal.reason as Error);
    }
    if (job.pcm.byteLength < MIN_JOB_BYTES) {
      return Promise.resolve('');
    }
    return runTranscribeCli({
      binary: this.deps.binary,
      model: job.context.model,
      backend: this.deps.backend,
      threads: this.deps.threads,
      language: job.context.language,
      pcm: job.pcm,
      timeoutMs: this.deps.timeoutMs,
      signal,
    });
  }
}
