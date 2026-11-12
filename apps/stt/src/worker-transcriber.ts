import { ResidentTranscriber, type ResidentTranscriberOptions } from '@codevo-whisper/stt-runner';
import type { Transcriber, TranscriberCall } from './transcriber';

export class WorkerTranscriber implements Transcriber {
  private readonly worker: ResidentTranscriber;

  constructor(options: ResidentTranscriberOptions) {
    this.worker = new ResidentTranscriber(options);
  }

  transcribe(call: TranscriberCall): Promise<string> {
    return this.worker.transcribe(call);
  }

  ready(): boolean {
    return this.worker.ready();
  }

  warmUp(): Promise<void> {
    return this.worker.warmUp();
  }

  close(): Promise<void> {
    return this.worker.close();
  }
}
