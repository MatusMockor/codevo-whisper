import type { JobOutcome, JobSubmitter, TranscriptionJob } from '@codevo-whisper/audio';
import type { GatewayContext } from './gateway-context';
import { ModelLoadingError } from './model-loading-error';
import type { ModelPreparation } from './stt-client';

export const MAX_MODEL_LOADS = 3;

type Preparation = { kind: 'ready' } | { kind: 'failed'; error: unknown };

const READY: Preparation = { kind: 'ready' };
const CANCELLED: JobOutcome = { status: 'dropped', reason: 'cancelled' };
const LOADING: JobOutcome = { status: 'dropped', reason: 'model-loading' };

function isModelLoading(outcome: JobOutcome): boolean {
  return outcome.status === 'failed' && outcome.error instanceof ModelLoadingError;
}

export class ModelReadyGate implements JobSubmitter<GatewayContext> {
  private readonly stopped = new AbortController();
  private ready = false;
  private preparation: Promise<Preparation>;

  constructor(
    private readonly inner: JobSubmitter<GatewayContext>,
    private readonly models: ModelPreparation,
    private readonly model: string,
  ) {
    this.preparation = this.prepare();
  }

  submit(job: TranscriptionJob<GatewayContext>): Promise<JobOutcome> {
    if (job.kind === 'partial' && !this.ready) {
      return Promise.resolve(LOADING);
    }
    return this.submitWhenReady(job, MAX_MODEL_LOADS);
  }

  cancelSession(sessionId: string): void {
    this.stopped.abort();
    this.inner.cancelSession(sessionId);
  }

  dropQueued(sessionId: string): void {
    this.stopped.abort();
    this.inner.dropQueued(sessionId);
  }

  private async submitWhenReady(job: TranscriptionJob<GatewayContext>, loads: number): Promise<JobOutcome> {
    const preparation = await this.preparation;
    if (this.stopped.signal.aborted) {
      return CANCELLED;
    }
    if (preparation.kind === 'failed') {
      return { status: 'failed', error: preparation.error };
    }
    const outcome = await this.inner.submit(job);
    if (loads <= 1 || !isModelLoading(outcome)) {
      return outcome;
    }
    this.prepareAgain();
    return this.submitWhenReady(job, loads - 1);
  }

  private prepareAgain(): void {
    if (!this.ready) {
      return;
    }
    this.preparation = this.prepare();
  }

  private prepare(): Promise<Preparation> {
    this.ready = false;
    return this.models.prepare(this.model, this.stopped.signal).then(
      () => {
        this.ready = true;
        return READY;
      },
      (error: unknown) => ({ kind: 'failed', error }),
    );
  }
}

export function submitterFor(dispatcher: JobSubmitter<GatewayContext>, models: ModelPreparation, model: string | null): JobSubmitter<GatewayContext> {
  if (model === null) {
    return dispatcher;
  }
  return new ModelReadyGate(dispatcher, models, model);
}
