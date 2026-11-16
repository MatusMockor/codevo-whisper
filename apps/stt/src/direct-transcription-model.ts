import { SingleFlightWarmUp } from './single-flight-warm-up';
import { DirectJob, PlainJob, type TranscriptionJob } from './transcription-job';
import type { TranscriptionModel } from './transcription-model';
import type { ValidQuery } from './transcribe-query';
import type { Transcriber } from './transcriber';

export class DirectTranscriptionModel implements TranscriptionModel {
  private readonly warmUp: SingleFlightWarmUp;

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly transcriber: Transcriber,
    private readonly present: boolean,
  ) {
    this.warmUp = new SingleFlightWarmUp(transcriber);
  }

  available(): boolean {
    return this.present;
  }

  prepare(): Promise<void> {
    return this.warmUp.run();
  }

  jobFor(query: ValidQuery): TranscriptionJob {
    if (query.kind === 'plain') {
      return new PlainJob(this.transcriber, query);
    }
    return new DirectJob(this.transcriber, query);
  }
}
