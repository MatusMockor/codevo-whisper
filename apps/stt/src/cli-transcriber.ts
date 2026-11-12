import { runTranscribeCli, type TranscribeBackend } from '@codevo-whisper/stt-runner';
import type { Transcriber, TranscriberCall } from './transcriber';

export type CliTranscriberOptions = { binary: string; model: string; backend: TranscribeBackend; threads: number; timeoutMs?: number };

export class CliTranscriber implements Transcriber {
  constructor(private readonly options: CliTranscriberOptions) {}

  transcribe(call: TranscriberCall): Promise<string> {
    return runTranscribeCli({ ...this.options, ...call });
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
