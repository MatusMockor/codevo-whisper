import type { ModelJobs } from './model-jobs';
import type { TranscriptionJob } from './transcription-job';
import type { TranscriptionModel } from './transcription-model';
import type { ValidQuery } from './transcribe-query';

export class ResidentTranscriptionModel implements TranscriptionModel {
  constructor(
    readonly id: string,
    readonly name: string,
    private readonly jobs: ModelJobs,
  ) {}

  available(): boolean {
    return true;
  }

  ready(): boolean {
    return true;
  }

  prepare(): Promise<void> {
    return Promise.resolve();
  }

  use<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }

  jobFor(query: ValidQuery): TranscriptionJob | null {
    return this.jobs.jobFor(query);
  }
}
