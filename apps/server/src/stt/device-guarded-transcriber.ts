import type { SegmentTranscriber, TranscriptionJob } from '@codevo-whisper/audio';
import { ProtocolError } from '@codevo-whisper/protocol';
import { KeyedTokenBucket, type BucketLimits } from '../gateway/keyed-token-bucket';
import type { GatewayContext } from './gateway-context';

export type GuardLimits = { inferences: BucketLimits; aborts: BucketLimits };

export class DeviceGuardedTranscriber implements SegmentTranscriber<GatewayContext> {
  private readonly inferences: KeyedTokenBucket;
  private readonly aborts: KeyedTokenBucket;

  constructor(
    private readonly inner: SegmentTranscriber<GatewayContext>,
    clock: () => number,
    limits: GuardLimits,
  ) {
    this.inferences = new KeyedTokenBucket(clock, limits.inferences);
    this.aborts = new KeyedTokenBucket(clock, limits.aborts);
  }

  async transcribe(job: TranscriptionJob<GatewayContext>, signal: AbortSignal): Promise<string> {
    if (!this.inferences.take(job.deviceId)) {
      throw new ProtocolError('busy', 'too many transcriptions started by this device');
    }
    const forwarded = new AbortController();
    const onAbort = (): void => {
      if (this.aborts.take(job.deviceId)) {
        forwarded.abort(signal.reason);
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await this.inner.transcribe(job, forwarded.signal);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
}
