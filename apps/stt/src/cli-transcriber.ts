import { runTranscribeCli, type TranscribeBackend, type TranscribeLanguage } from '@codevo-whisper/stt-runner';
import type { Transcriber } from './transcriber';

export type CliTranscriberOptions = { binary: string; model: string; backend: TranscribeBackend; threads: number; timeoutMs?: number };

export class CliTranscriber implements Transcriber {
  constructor(private readonly options: CliTranscriberOptions) {}

  transcribe(pcm: Uint8Array, language: TranscribeLanguage, signal: AbortSignal): Promise<string> {
    return runTranscribeCli({ ...this.options, language, pcm, signal });
  }

  ready(): boolean {
    return true;
  }

  warmUp(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
