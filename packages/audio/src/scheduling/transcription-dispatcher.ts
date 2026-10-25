import type { Clock } from '../clock';
import { DEFAULT_PARTIAL_CONFIG, validatePartialConfig, type PartialConfig } from '../partials/partial-config';
import { partialIntervalMs, type PartialIntervalSource } from '../partials/partial-interval';
import { ServiceTimeEstimator } from '../partials/service-time-estimator';
import { FairJobQueue, type QueueStats } from './fair-job-queue';
import type { DeviceRegistry, JobOutcome, JobSubmitter } from './job-outcome';
import type { SegmentTranscriber } from './segment-transcriber';
import type { Dropped, TranscriptionContext, TranscriptionJob } from './transcription-job';

type Entry<TContext> = {
  job: TranscriptionJob<TContext>;
  resolve: (outcome: JobOutcome) => void;
  controller: AbortController;
};

type SessionRegistration = { deviceId: string; partials: boolean };

export type TranscriptionDispatcherDeps<TContext> = {
  transcriber: SegmentTranscriber<TContext>;
  clock: Clock;
  partials?: Partial<PartialConfig>;
};

const CANCELLED: JobOutcome = { status: 'dropped', reason: 'cancelled' };

export class TranscriptionDispatcher<TContext = TranscriptionContext> implements JobSubmitter<TContext>, DeviceRegistry {
  private readonly queue = new FairJobQueue<Entry<TContext>>();
  private readonly running = new Set<Entry<TContext>>();
  private readonly sessions = new Map<string, SessionRegistration>();
  private sessionCounter = 0;
  private readonly serviceTime = new ServiceTimeEstimator();
  private readonly config: PartialConfig;
  private idleWaiters: (() => void)[] = [];
  private pumping = false;

  constructor(private readonly deps: TranscriptionDispatcherDeps<TContext>) {
    this.config = validatePartialConfig({ ...DEFAULT_PARTIAL_CONFIG, ...deps.partials });
  }

  submit(job: TranscriptionJob<TContext>): Promise<JobOutcome> {
    return new Promise<JobOutcome>((resolve) => {
      this.settleDropped(this.queue.offer({ job, resolve, controller: new AbortController() }));
      void this.pump();
    });
  }

  cancelSession(sessionId: string): void {
    this.settleDropped(this.queue.removeSession(sessionId));
    for (const entry of this.running) {
      if (entry.job.sessionId === sessionId) {
        entry.controller.abort();
      }
    }
  }

  attach(deviceId: string, partials: boolean): string {
    this.sessionCounter += 1;
    const sessionId = `${deviceId}#${this.sessionCounter}`;
    this.sessions.set(sessionId, { deviceId, partials });
    return sessionId;
  }

  detach(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.queue.releaseSession(sessionId);
  }

  pendingJobs(): number {
    return this.queue.size + this.running.size;
  }

  queueStats(): QueueStats {
    return this.queue.stats();
  }

  partialIntervalSource(): PartialIntervalSource {
    return { partialIntervalMs: () => partialIntervalMs(this.liveDevices(), this.serviceTime.valueMs, this.config) };
  }

  whenIdle(): Promise<void> {
    if (!this.pumping) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private liveDevices(): number {
    const live = [...this.sessions.values()].filter((session) => session.partials).map((session) => session.deviceId);
    return new Set(live).size;
  }

  private async pump(): Promise<void> {
    if (this.pumping) {
      return;
    }
    this.pumping = true;
    let entry = this.queue.take();
    while (entry !== undefined) {
      await this.run(entry);
      entry = this.queue.take();
    }
    this.pumping = false;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  private async run(entry: Entry<TContext>): Promise<void> {
    this.running.add(entry);
    const startedAt = this.deps.clock.now();
    try {
      const text = await this.deps.transcriber.transcribe(entry.job, entry.controller.signal);
      this.serviceTime.record(this.deps.clock.now() - startedAt);
      entry.resolve(entry.controller.signal.aborted ? CANCELLED : { status: 'done', text });
    } catch (error) {
      entry.resolve(entry.controller.signal.aborted ? CANCELLED : { status: 'failed', error });
    } finally {
      this.running.delete(entry);
      this.queue.complete(entry);
    }
  }

  private settleDropped(dropped: Dropped<Entry<TContext>>[]): void {
    for (const { entry, reason } of dropped) {
      entry.resolve({ status: 'dropped', reason });
    }
  }
}
