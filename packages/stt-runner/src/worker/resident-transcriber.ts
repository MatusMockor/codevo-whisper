import { setTimeout as sleep } from 'node:timers/promises';
import { MAX_OUTPUT_BYTES, type TranscribeBackend, type TranscribeLanguage } from '../run-transcribe-cli';
import { TranscribeCliError } from '../transcribe-cli-error';
import { RestartBackoff, type BackoffOptions } from './restart-backoff';
import { encodeWorkerRequest } from './worker-frames';
import { WorkerProcess } from './worker-process';

export type ResidentTranscriberOptions = {
  binary: string;
  model: string;
  backend: TranscribeBackend;
  threads: number;
  timeoutMs?: number;
  startupTimeoutMs?: number;
  abortGraceMs?: number;
  backoff?: BackoffOptions;
};

export type WorkerCall = { pcm: Uint8Array; language: TranscribeLanguage; signal?: AbortSignal };

type Outcome = { resolve: (text: string) => void; reject: (error: Error) => void };

type EngineState = 'starting' | 'ready' | 'failed';

export const RESIDENT_DEFAULTS = {
  timeoutMs: 30_000,
  startupTimeoutMs: 120_000,
  abortGraceMs: 2_000,
  backoff: { initialMs: 500, maxMs: 30_000 },
} as const;

function closedError(): TranscribeCliError {
  return new TranscribeCliError('exit', 'transcribe worker is closed');
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export class ResidentTranscriber {
  private worker: WorkerProcess | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private state: EngineState = 'starting';
  private readonly backoff: RestartBackoff;
  private readonly timeoutMs: number;
  private readonly startupTimeoutMs: number;
  private readonly abortGraceMs: number;

  constructor(private readonly options: ResidentTranscriberOptions) {
    this.backoff = new RestartBackoff(options.backoff ?? RESIDENT_DEFAULTS.backoff);
    this.timeoutMs = options.timeoutMs ?? RESIDENT_DEFAULTS.timeoutMs;
    this.startupTimeoutMs = options.startupTimeoutMs ?? RESIDENT_DEFAULTS.startupTimeoutMs;
    this.abortGraceMs = options.abortGraceMs ?? RESIDENT_DEFAULTS.abortGraceMs;
  }

  ready(): boolean {
    return this.state === 'ready';
  }

  transcribe(call: WorkerCall): Promise<string> {
    if (call.signal?.aborted === true) {
      return Promise.reject(asError(call.signal.reason));
    }
    return new Promise<string>((resolve, reject) => {
      const onAbort = (): void => reject(asError(call.signal?.reason));
      call.signal?.addEventListener('abort', onAbort, { once: true });
      void this.enqueue(() => this.serve(call, { resolve, reject })).finally(() => call.signal?.removeEventListener('abort', onAbort));
    });
  }

  warmUp(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      void this.enqueue(async () => {
        if (this.closed) {
          reject(closedError());
          return;
        }
        await this.acquire().then(() => resolve(), (error: unknown) => reject(asError(error)));
      });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const worker = this.worker;
    worker?.kill();
    await worker?.terminated;
    await this.queue;
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const slot = this.queue.then(task);
    this.queue = slot.catch(() => undefined);
    return slot;
  }

  private async serve(call: WorkerCall, outcome: Outcome): Promise<void> {
    if (this.closed) {
      outcome.reject(closedError());
      return;
    }
    if (isAborted(call.signal)) {
      return;
    }
    const worker = await this.acquire().catch((error: unknown) => {
      outcome.reject(asError(error));
      return undefined;
    });
    if (worker === undefined || isAborted(call.signal)) {
      return;
    }
    await this.infer(worker, call, outcome);
  }

  private async acquire(): Promise<WorkerProcess> {
    if (this.worker?.alive === true) {
      await this.awaitReady(this.worker);
      return this.worker;
    }
    await this.worker?.terminated;
    await sleep(this.backoff.delayMs());
    if (this.closed) {
      throw closedError();
    }
    const worker = this.spawn();
    this.worker = worker;
    await this.awaitReady(worker);
    return worker;
  }

  private awaitReady(worker: WorkerProcess): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(worker);
        worker.kill();
        reject(new TranscribeCliError('timeout', `transcribe worker did not start within ${this.startupTimeoutMs} ms`));
      }, this.startupTimeoutMs);
      worker.ready.then(
        () => {
          clearTimeout(timer);
          this.state = 'ready';
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timer);
          this.fail(worker);
          reject(asError(error));
        },
      );
    });
  }

  private infer(worker: WorkerProcess, call: WorkerCall, outcome: Outcome): Promise<void> {
    return new Promise<void>((release) => {
      const timers: NodeJS.Timeout[] = [];
      const finish = (): void => {
        timers.forEach((timer) => clearTimeout(timer));
        call.signal?.removeEventListener('abort', onAbort);
        release();
      };
      const abandon = (): void => {
        this.backoff.recordFailure();
        worker.kill();
        finish();
      };
      const onAbort = (): void => {
        timers.push(setTimeout(abandon, this.abortGraceMs));
      };
      timers.push(
        setTimeout(() => {
          outcome.reject(new TranscribeCliError('timeout', `transcribe worker timed out after ${this.timeoutMs} ms`));
          abandon();
        }, this.timeoutMs),
      );
      call.signal?.addEventListener('abort', onAbort, { once: true });
      worker.request(encodeWorkerRequest(call.language, call.pcm)).then(
        (text) => {
          this.backoff.reset();
          outcome.resolve(text.trim());
          finish();
        },
        (error: unknown) => {
          outcome.reject(asError(error));
          this.noteExit(worker);
          finish();
        },
      );
    });
  }

  private noteExit(worker: WorkerProcess): void {
    if (!worker.crashed) {
      return;
    }
    this.fail(worker);
  }

  private fail(worker: WorkerProcess): void {
    if (this.worker !== worker) {
      return;
    }
    this.state = 'failed';
    this.backoff.recordFailure();
  }

  private spawn(): WorkerProcess {
    const { binary, model, backend, threads } = this.options;
    this.state = this.state === 'ready' ? 'ready' : 'starting';
    return new WorkerProcess({ binary, args: ['--model', model, '--backend', backend, '--threads', String(threads)], maxTextBytes: MAX_OUTPUT_BYTES });
  }
}
