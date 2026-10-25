import type { Clock } from '../clock';
import { DEFAULT_PARTIAL_CONFIG, validatePartialConfig, type PartialConfig } from '../partials/partial-config';
import { partialIntervalMs, type PartialIntervalSource } from '../partials/partial-interval';
import { ServiceTimeEstimator } from '../partials/service-time-estimator';
import { FairJobQueue } from './fair-job-queue';
import type { DeviceRegistry, JobOutcome, JobSubmitter } from './job-outcome';
import type { SegmentTranscriber } from './segment-transcriber';
import type { Dropped, TranscriptionJob } from './transcription-job';

type Entry = {
  job: TranscriptionJob;
  resolve: (outcome: JobOutcome) => void;
  controller: AbortController;
};

export type TranscriptionDispatcherDeps = {
  transcriber: SegmentTranscriber;
  clock: Clock;
  partials?: Partial<PartialConfig>;
};

const CANCELLED: JobOutcome = { status: 'dropped', reason: 'cancelled' };

export class TranscriptionDispatcher implements JobSubmitter, DeviceRegistry {
  private readonly queue = new FairJobQueue<Entry>();
  private readonly running = new Set<Entry>();
  private readonly devices = new Map<string, boolean>();
  private readonly serviceTime = new ServiceTimeEstimator();
  private readonly config: PartialConfig;
  private idleWaiters: (() => void)[] = [];
  private pumping = false;

  constructor(private readonly deps: TranscriptionDispatcherDeps) {
    this.config = validatePartialConfig({ ...DEFAULT_PARTIAL_CONFIG, ...deps.partials });
  }

  submit(job: TranscriptionJob): Promise<JobOutcome> {
    return new Promise<JobOutcome>((resolve) => {
      this.settleDropped(this.queue.offer({ job, resolve, controller: new AbortController() }));
      void this.pump();
    });
  }

  cancelDevice(deviceId: string): void {
    this.settleDropped(this.queue.removeDevice(deviceId));
    for (const entry of this.running) {
      if (entry.job.deviceId === deviceId) {
        entry.controller.abort();
      }
    }
  }

  attach(deviceId: string, partials: boolean): void {
    this.devices.set(deviceId, partials);
  }

  detach(deviceId: string): void {
    this.devices.delete(deviceId);
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
    return [...this.devices.values()].filter((partials) => partials).length;
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

  private async run(entry: Entry): Promise<void> {
    this.running.add(entry);
    const startedAt = this.deps.clock.now();
    try {
      const text = await this.deps.transcriber.transcribe(entry.job.pcm, entry.controller.signal);
      this.serviceTime.record(this.deps.clock.now() - startedAt);
      entry.resolve(entry.controller.signal.aborted ? CANCELLED : { status: 'done', text });
    } catch (error) {
      entry.resolve(entry.controller.signal.aborted ? CANCELLED : { status: 'failed', error });
    } finally {
      this.running.delete(entry);
      this.queue.complete(entry);
    }
  }

  private settleDropped(dropped: Dropped<Entry>[]): void {
    for (const { entry, reason } of dropped) {
      entry.resolve({ status: 'dropped', reason });
    }
  }
}
