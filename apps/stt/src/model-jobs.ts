import type { LanguageRouter } from './language-router';
import { DirectJob, PlainJob, RoutedJob, type TranscriptionJob } from './transcription-job';
import type { ValidQuery } from './transcribe-query';
import type { Transcriber } from './transcriber';

export interface ModelJobs {
  jobFor(query: ValidQuery): TranscriptionJob | null;
}

export class DirectJobs implements ModelJobs {
  constructor(private readonly transcriber: Transcriber) {}

  jobFor(query: ValidQuery): TranscriptionJob {
    if (query.kind === 'plain') {
      return new PlainJob(this.transcriber, query);
    }
    return new DirectJob(this.transcriber, query);
  }
}

export class RoutedJobs implements ModelJobs {
  constructor(
    private readonly transcriber: Transcriber,
    private readonly router: LanguageRouter,
  ) {}

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
