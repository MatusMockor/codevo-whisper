import type { IdentificationRequest, LanguageScore } from '@codevo-whisper/language-routing';
import { runLanguageIdCli, type TranscribeBackend } from '@codevo-whisper/stt-runner';
import type { LanguageIdRunner } from './language-id-runner';

export type CliLanguageIdentifierOptions = { binary: string; model: string; backend: TranscribeBackend; threads: number; timeoutMs?: number };

export class CliLanguageIdentifier implements LanguageIdRunner {
  constructor(private readonly options: CliLanguageIdentifierOptions) {}

  identify(request: IdentificationRequest): Promise<readonly LanguageScore[]> {
    return runLanguageIdCli({ ...this.options, ...request });
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
