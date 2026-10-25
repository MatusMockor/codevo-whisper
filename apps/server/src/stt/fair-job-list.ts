import type { TranscriptionJob } from './transcription-job';

export class FairJobList {
  private readonly byDevice = new Map<string, TranscriptionJob[]>();
  private order: string[] = [];
  private lastDevice: string | null = null;

  add(job: TranscriptionJob): void {
    const jobs = this.byDevice.get(job.deviceId);
    if (jobs !== undefined) {
      jobs.push(job);
      return;
    }
    this.byDevice.set(job.deviceId, [job]);
    this.order.push(job.deviceId);
  }

  next(): TranscriptionJob | undefined {
    const deviceId = this.order.find((id) => id !== this.lastDevice) ?? this.order[0];
    if (deviceId === undefined) {
      return undefined;
    }
    const jobs = this.byDevice.get(deviceId) ?? [];
    const job = jobs.shift();
    this.order = this.order.filter((id) => id !== deviceId);
    if (jobs.length > 0) {
      this.order.push(deviceId);
    }
    if (jobs.length === 0) {
      this.byDevice.delete(deviceId);
    }
    this.lastDevice = deviceId;
    return job;
  }

  remove(predicate: (job: TranscriptionJob) => boolean): TranscriptionJob[] {
    const removed: TranscriptionJob[] = [];
    this.byDevice.forEach((jobs, deviceId) => {
      const kept = jobs.filter((job) => !predicate(job));
      removed.push(...jobs.filter(predicate));
      if (kept.length > 0) {
        this.byDevice.set(deviceId, kept);
        return;
      }
      this.byDevice.delete(deviceId);
      this.order = this.order.filter((id) => id !== deviceId);
    });
    return removed;
  }

  size(): number {
    let total = 0;
    this.byDevice.forEach((jobs) => {
      total += jobs.length;
    });
    return total;
  }
}
