import type { SegmentTranscriber, TranscriptionJob } from '@codevo-whisper/audio';
import type { GatewayContext } from './gateway-context';
import type { SttClient } from './stt-client';

export const MIN_STT_BYTES = 640;

export class SttSegmentTranscriber implements SegmentTranscriber<GatewayContext> {
  constructor(private readonly client: SttClient) {}

  transcribe(job: TranscriptionJob<GatewayContext>, signal: AbortSignal): Promise<string> {
    if (job.pcm.length < MIN_STT_BYTES) {
      return Promise.resolve('');
    }
    return this.client.transcribe(job.pcm, job.context.language, signal);
  }
}
