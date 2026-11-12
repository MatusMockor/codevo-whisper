import type { LanguageCode, LanguageScore } from '../languages';
import { LanguageIdCodec, type LanguageIdRequest } from './language-id-codec';
import { ResidentWorker, type ResidentWorkerOptions } from './resident-worker';

export type ResidentLanguageIdentifierOptions = ResidentWorkerOptions;

export type LanguageIdCall = { pcm: Uint8Array; allowed: readonly LanguageCode[]; signal?: AbortSignal };

export class ResidentLanguageIdentifier {
  private readonly worker: ResidentWorker<LanguageIdRequest, LanguageScore[]>;

  constructor(options: ResidentLanguageIdentifierOptions) {
    this.worker = new ResidentWorker(options, new LanguageIdCodec());
  }

  ready(): boolean {
    return this.worker.ready();
  }

  identify(call: LanguageIdCall): Promise<LanguageScore[]> {
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
