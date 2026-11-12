import { setTimeout as sleep } from 'node:timers/promises';
import type { TranscribeBackend } from '../run-transcribe-cli';
import { TranscribeCliError } from '../transcribe-cli-error';
import type { FrameCodec } from './frame-codec';
import { RestartBackoff, type BackoffOptions } from './restart-backoff';
import { WorkerProcess } from './worker-process';

export type ResidentWorkerOptions = {
  binary: string;
  model: string;
  backend: TranscribeBackend;
  threads: number;
  timeoutMs?: number;
  startupTimeoutMs?: number;
  abortGraceMs?: number;
  backoff?: BackoffOptions;
  startupFallback?: { binary: string; backend: 'cpu' };
};

type Outcome<Result> = { resolve: (result: Result) => void; reject: (error: Error) => void };

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

export class ResidentWorker<Request, Result> {
  private worker: WorkerProcess | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private state: EngineState = 'starting';
  private readonly backoff: RestartBackoff;
  private readonly timeoutMs: number;
  private readonly startupTimeoutMs: number;
  private readonly abortGraceMs: number;
  private fallbackSelected = false;

  constructor(
    private readonly options: ResidentWorkerOptions,
    private readonly codec: FrameCodec<Request, Result>,
  ) {
    this.backoff = new RestartBackoff(options.backoff ?? RESIDENT_DEFAULTS.backoff);
    this.timeoutMs = options.timeoutMs ?? RESIDENT_DEFAULTS.timeoutMs;
    this.startupTimeoutMs = options.startupTimeoutMs ?? RESIDENT_DEFAULTS.startupTimeoutMs;
    this.abortGraceMs = options.abortGraceMs ?? RESIDENT_DEFAULTS.abortGraceMs;
  }

  ready(): boolean {
    return this.state === 'ready';
  }

  run(request: Request, signal?: AbortSignal): Promise<Result> {
    if (signal?.aborted === true) {
      return Promise.reject(asError(signal.reason));
    }
    return new Promise<Result>((resolve, reject) => {
      const onAbort = (): void => reject(asError(signal?.reason));
      signal?.addEventListener('abort', onAbort, { once: true });
      void this.enqueue(() => this.serve(request, signal, { resolve, reject })).finally(() => signal?.removeEventListener('abort', onAbort));
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

  private async serve(request: Request, signal: AbortSignal | undefined, outcome: Outcome<Result>): Promise<void> {
    if (this.closed) {
      outcome.reject(closedError());
      return;
    }
    if (isAborted(signal)) {
      return;
    }
    const frame = this.encode(request, outcome);
    if (frame === undefined) {
      return;
    }
    const worker = await this.acquire(signal).catch((error: unknown) => {
      outcome.reject(asError(error));
      return undefined;
    });
    if (worker === undefined || isAborted(signal)) {
      return;
    }
    await this.infer(worker, frame, request, signal, outcome);
  }

  private encode(request: Request, outcome: Outcome<Result>): Uint8Array | undefined {
    try {
      return this.codec.encode(request);
    } catch (error) {
      outcome.reject(asError(error));
      return undefined;
    }
  }

  private decode(reply: string, request: Request, outcome: Outcome<Result>): void {
    try {
      outcome.resolve(this.codec.decode(reply, request));
    } catch (error) {
      outcome.reject(asError(error));
    }
  }

  private async acquire(signal?: AbortSignal): Promise<WorkerProcess> {
    if (isAborted(signal)) throw asError(signal?.reason);
    if (this.worker?.alive === true) {
      await this.awaitReady(this.worker, signal);
      return this.worker;
    }
    await this.worker?.terminated;
    await sleep(this.backoff.delayMs(), undefined, { signal });
    if (this.closed) {
      throw closedError();
    }
    let worker = this.spawn();
    this.worker = worker;
    try {
      await this.awaitReady(worker, signal);
    } catch (error) {
      worker.kill();
      await worker.terminated;
      if (this.closed || isAborted(signal) || this.fallbackSelected || this.options.startupFallback === undefined) throw error;
      this.fallbackSelected = true;
      worker = this.spawn();
      this.worker = worker;
      await this.awaitReady(worker, signal);
    }
    return worker;
  }

  private awaitReady(worker: WorkerProcess, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        worker.kill();
        reject(asError(signal?.reason));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        this.fail(worker);
        worker.kill();
        reject(new TranscribeCliError('timeout', `transcribe worker did not start within ${this.startupTimeoutMs} ms`));
      }, this.startupTimeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.ready.then(
        () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          if (this.closed || isAborted(signal) || !worker.alive) {
            reject(this.closed ? closedError() : asError(signal?.reason ?? 'worker stopped before READY'));
            return;
          }
          this.state = 'ready';
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          this.fail(worker);
          reject(asError(error));
        },
      );
    });
  }

  private infer(worker: WorkerProcess, frame: Uint8Array, request: Request, signal: AbortSignal | undefined, outcome: Outcome<Result>): Promise<void> {
    return new Promise<void>((release) => {
      const timers: NodeJS.Timeout[] = [];
      const finish = (): void => {
        timers.forEach((timer) => clearTimeout(timer));
        signal?.removeEventListener('abort', onAbort);
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
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.request(frame).then(
        (reply) => {
          this.backoff.reset();
          this.decode(reply, request, outcome);
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
    const { model, threads } = this.options;
    const { binary, backend } = this.fallbackSelected && this.options.startupFallback !== undefined ? this.options.startupFallback : this.options;
    this.state = this.state === 'ready' ? 'ready' : 'starting';
    return new WorkerProcess({ binary, args: ['--model', model, '--backend', backend, '--threads', String(threads)], maxTextBytes: this.codec.maxReplyBytes });
  }
}
