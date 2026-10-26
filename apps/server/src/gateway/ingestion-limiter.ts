import { KeyedTokenBucket } from './keyed-token-bucket';
import { BYTES_PER_SECOND } from './pcm';

export type IngestionLimits = {
  burstSeconds: number;
  realTimeFactor: number;
  pauseBelowSeconds: number;
  resumeAboveSeconds: number;
};

export class IngestionLimiter {
  private readonly bucket: KeyedTokenBucket;

  constructor(
    clock: () => number,
    readonly limits: IngestionLimits,
  ) {
    this.bucket = new KeyedTokenBucket(clock, {
      capacity: limits.burstSeconds * BYTES_PER_SECOND,
      perSecond: limits.realTimeFactor * BYTES_PER_SECOND,
    });
  }

  take(deviceId: string, bytes: number): boolean {
    return this.bucket.take(deviceId, bytes);
  }

  availableSeconds(deviceId: string): number {
    return this.bucket.available(deviceId) / BYTES_PER_SECOND;
  }
}
