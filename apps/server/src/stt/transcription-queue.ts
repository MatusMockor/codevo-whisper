import { ProtocolError, type Language } from '@codevo-whisper/protocol';
import { FairJobList } from './fair-job-list';
import type { SttClient } from './stt-client';
import { abortError, type TranscriptionJob } from './transcription-job';

export type TranscriptionQueueOptions = { waitTimeoutMs: number; maxJobsPerDevice?: number };

export const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_JOBS_PER_DEVICE = 4;

export class TranscriptionQueue {
  private readonly waiting = new FairJobList();
  private running: TranscriptionJob | null = null;
  private readonly waitTimeoutMs: number;
  private readonly maxJobsPerDevice: number;

  constructor(
    private readonly client: SttClient,
    options: TranscriptionQueueOptions = { waitTimeoutMs: DEFAULT_WAIT_TIMEOUT_MS },
  ) {
    this.waitTimeoutMs = options.waitTimeoutMs;
    this.maxJobsPerDevice = options.maxJobsPerDevice ?? DEFAULT_MAX_JOBS_PER_DEVICE;
  }

  enqueue(deviceId: string, pcm: Uint8Array, language: Language, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted === true) {
      return Promise.reject(abortError());
    }
    if (this.jobsOf(deviceId) >= this.maxJobsPerDevice) {
      return Promise.reject(new ProtocolError('busy', 'too many transcriptions for this device'));
    }
    return new Promise<string>((resolve, reject) => {
      const job = this.createJob({ deviceId, pcm, language, signal, resolve, reject });
      this.waiting.add(job);
      this.pump();
    });
  }

  cancelDevice(deviceId: string): void {
    this.cancel((job) => job.deviceId === deviceId);
  }

  private jobsOf(deviceId: string): number {
    return this.waiting.countFor(deviceId) + (this.running?.deviceId === deviceId ? 1 : 0);
  }

  size(): number {
    return this.waiting.size() + (this.running === null ? 0 : 1);
  }

  private createJob(input: Omit<TranscriptionJob, 'controller' | 'dispose'>): TranscriptionJob {
    const job: TranscriptionJob = { ...input, controller: new AbortController(), dispose: () => undefined };
    const timer = setTimeout(() => this.expire(job), this.waitTimeoutMs);
    const onAbort = (): void => this.cancel((candidate) => candidate === job);
    input.signal?.addEventListener('abort', onAbort, { once: true });
    job.dispose = () => {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
    };
    return job;
  }

  private expire(job: TranscriptionJob): void {
    const [expired] = this.waiting.remove((candidate) => candidate === job);
    if (expired === undefined) {
      return;
    }
    expired.dispose();
    expired.reject(new ProtocolError('busy', 'the transcription waited too long in the queue'));
  }

  private cancel(predicate: (job: TranscriptionJob) => boolean): void {
    this.waiting.remove(predicate).forEach((job) => {
      job.dispose();
      job.reject(abortError());
    });
    if (this.running !== null && predicate(this.running)) {
      this.running.controller.abort(abortError());
    }
  }

  private pump(): void {
    if (this.running !== null) {
      return;
    }
    const job = this.waiting.next();
    if (job === undefined) {
      return;
    }
    this.running = job;
    job.dispose();
    void this.run(job);
  }

  private async run(job: TranscriptionJob): Promise<void> {
    const onAbort = (): void => job.controller.abort(abortError());
    job.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      job.resolve(await this.client.transcribe(job.pcm, job.language, job.controller.signal));
    } catch (error) {
      job.reject(error);
    } finally {
      job.signal?.removeEventListener('abort', onAbort);
      this.running = null;
      this.pump();
    }
  }
}
