import type { Transcriber } from './transcriber';

export class SingleFlightWarmUp {
  private pending: Promise<void> | null = null;

  constructor(private readonly transcriber: Pick<Transcriber, 'resident' | 'warmUp'>) {}

  run(): Promise<void> {
    if (this.transcriber.resident()) {
      return Promise.resolve();
    }
    this.pending ??= this.transcriber.warmUp().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}
