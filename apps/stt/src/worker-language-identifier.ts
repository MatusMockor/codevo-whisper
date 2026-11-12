import type { IdentificationRequest, LanguageScore } from '@codevo-whisper/language-routing';
import { ResidentLanguageIdentifier, type ResidentLanguageIdentifierOptions } from '@codevo-whisper/stt-runner';
import type { LanguageIdRunner } from './language-id-runner';

export class WorkerLanguageIdentifier implements LanguageIdRunner {
  private readonly worker: ResidentLanguageIdentifier;

  constructor(options: ResidentLanguageIdentifierOptions) {
    this.worker = new ResidentLanguageIdentifier(options);
  }

  identify(request: IdentificationRequest): Promise<readonly LanguageScore[]> {
    return this.worker.identify(request);
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
