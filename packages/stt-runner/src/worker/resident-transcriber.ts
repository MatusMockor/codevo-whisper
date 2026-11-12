import type { TranscribeLanguage } from '../run-transcribe-cli';
import { ResidentWorker, type ResidentWorkerOptions } from './resident-worker';
import { TranscriptionCodec, type TranscriptionRequest } from './transcription-codec';

export type ResidentTranscriberOptions = ResidentWorkerOptions;

export type WorkerCall = { pcm: Uint8Array; language: TranscribeLanguage; vocabulary?: readonly string[]; signal?: AbortSignal };

export class ResidentTranscriber {
  private readonly worker: ResidentWorker<TranscriptionRequest, string>;

  constructor(options: ResidentTranscriberOptions) {
    this.worker = new ResidentWorker(options, new TranscriptionCodec());
  }

  ready(): boolean {
    return this.worker.ready();
  }

  transcribe(call: WorkerCall): Promise<string> {
    const { signal, ...request } = call;
    return this.worker.run(request, signal);
  }

  warmUp(): Promise<void> {
    return this.worker.warmUp();
  }

  close(): Promise<void> {
    return this.worker.close();
  }
}
