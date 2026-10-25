import { BYTES_PER_SECOND } from './pcm';

export type IngestionLimits = {
  burstSeconds: number;
  realTimeFactor: number;
  pauseBelowSeconds: number;
  resumeAboveSeconds: number;
};

type Bucket = { bytes: number; updatedAt: number };

export class IngestionLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly bytesPerMs: number;

  constructor(
    private readonly clock: () => number,
    readonly limits: IngestionLimits,
  ) {
    this.capacity = limits.burstSeconds * BYTES_PER_SECOND;
    this.bytesPerMs = (limits.realTimeFactor * BYTES_PER_SECOND) / 1000;
  }

  take(deviceId: string, bytes: number): boolean {
    const available = this.available(deviceId);
    if (bytes > available) {
      return false;
    }
    this.buckets.set(deviceId, { bytes: available - bytes, updatedAt: this.clock() });
    return true;
  }

  availableSeconds(deviceId: string): number {
    return this.available(deviceId) / BYTES_PER_SECOND;
  }

  private available(deviceId: string): number {
    const bucket = this.buckets.get(deviceId);
    if (bucket === undefined) {
      return this.capacity;
    }
    const refilled = bucket.bytes + Math.max(0, this.clock() - bucket.updatedAt) * this.bytesPerMs;
    if (refilled >= this.capacity) {
      this.buckets.delete(deviceId);
      return this.capacity;
    }
    return refilled;
  }
}
