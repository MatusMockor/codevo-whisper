import type { LanguageRouter } from './language-router';
import { PlainJob, RoutedJob, type TranscriptionJob } from './transcription-job';
import type { TranscriptionModel } from './transcription-model';
import type { ValidQuery } from './transcribe-query';
import type { Transcriber } from './transcriber';

export class RoutingTranscriptionModel implements TranscriptionModel {
  constructor(
    readonly id: string,
    readonly name: string,
    private readonly transcriber: Transcriber,
    private readonly router: LanguageRouter,
  ) {}

  available(): boolean {
    return true;
  }

  prepare(): Promise<void> {
    return Promise.resolve();
  }

  jobFor(query: ValidQuery): TranscriptionJob | null {
    if (query.kind === 'plain') {
      return new PlainJob(this.transcriber, query);
    }
    if (this.router.languages().length === 0) {
      return null;
    }
    return new RoutedJob(this.router, query);
  }
}
