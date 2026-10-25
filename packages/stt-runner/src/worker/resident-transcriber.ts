import { DEFAULT_TIMEOUT_MS, MAX_OUTPUT_BYTES, type TranscribeBackend, type TranscribeLanguage } from '../run-transcribe-cli';
import { TranscribeCliError } from '../transcribe-cli-error';
import { encodeWorkerRequest } from './worker-frames';
import { WorkerProcess } from './worker-process';

export type ResidentTranscriberOptions = {
  binary: string;
  model: string;
  backend: TranscribeBackend;
  threads: number;
  timeoutMs?: number;
};

export type WorkerCall = { pcm: Uint8Array; language: TranscribeLanguage; signal?: AbortSignal };

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export class ResidentTranscriber {
  private worker: WorkerProcess | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(private readonly options: ResidentTranscriberOptions) {}

  transcribe(call: WorkerCall): Promise<string> {
    const run = this.queue.then(() => this.run(call));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async warmUp(): Promise<void> {
    const worker = this.current();
    try {
      await worker.ready;
    } catch (error) {
      this.forgetIfDead(worker);
      throw error;
    }
  }

  close(): Promise<void> {
    this.closed = true;
    this.worker?.kill();
    this.worker = undefined;
    return this.queue.then(() => undefined);
  }

  private run(call: WorkerCall): Promise<string> {
    call.signal?.throwIfAborted();
    const worker = this.current();
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise<string>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        call.signal?.removeEventListener('abort', onAbort);
      };
      const stop = (error: unknown): void => {
        cleanup();
        this.replace(worker);
        reject(asError(error));
      };
      const onAbort = (): void => stop(call.signal?.reason);
      const timer = setTimeout(() => stop(new TranscribeCliError('timeout', `transcribe worker timed out after ${timeoutMs} ms`)), timeoutMs);
      call.signal?.addEventListener('abort', onAbort, { once: true });
      worker.ready
        .then(() => worker.request(encodeWorkerRequest(call.language, call.pcm)))
        .then(
          (text) => {
            cleanup();
            resolve(text.trim());
          },
          (error: unknown) => {
            cleanup();
            this.forgetIfDead(worker);
            reject(asError(error));
          },
        );
    });
  }

  private current(): WorkerProcess {
    this.worker ??= this.spawn();
    return this.worker;
  }

  private spawn(): WorkerProcess {
    const { binary, model, backend, threads } = this.options;
    return new WorkerProcess({ binary, args: ['--model', model, '--backend', backend, '--threads', String(threads)], maxTextBytes: MAX_OUTPUT_BYTES });
  }

  private replace(worker: WorkerProcess): void {
    worker.kill();
    if (this.worker !== worker) {
      return;
    }
    this.worker = this.closed ? undefined : this.spawn();
  }

  private forgetIfDead(worker: WorkerProcess): void {
    if (this.worker === worker && !worker.alive) {
      this.worker = undefined;
    }
  }
}
