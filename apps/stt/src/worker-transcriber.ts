import { ResidentTranscriber, type ResidentTranscriberOptions, type TranscribeLanguage } from '@codevo-whisper/stt-runner';
import type { Transcriber } from './transcriber';

export class WorkerTranscriber implements Transcriber {
  private readonly worker: ResidentTranscriber;

  constructor(options: ResidentTranscriberOptions) {
    this.worker = new ResidentTranscriber(options);
  }

  transcribe(pcm: Uint8Array, language: TranscribeLanguage, signal: AbortSignal): Promise<string> {
    return this.worker.transcribe({ pcm, language, signal });
  }

  warmUp(): Promise<void> {
    return this.worker.warmUp();
  }

  close(): Promise<void> {
    return this.worker.close();
  }
}
