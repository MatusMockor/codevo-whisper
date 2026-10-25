import type { SegmentTranscriber, TranscriptionJob } from '@codevo-whisper/audio';
import type { GatewayContext } from './gateway-context';
import type { SttClient } from './stt-client';

export class SttSegmentTranscriber implements SegmentTranscriber<GatewayContext> {
  constructor(private readonly client: SttClient) {}

  transcribe(job: TranscriptionJob<GatewayContext>, signal: AbortSignal): Promise<string> {
    return this.client.transcribe(job.pcm, job.context.language, signal);
  }
}
