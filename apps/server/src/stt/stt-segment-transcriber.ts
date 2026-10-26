import { setTimeout as sleep } from 'node:timers/promises';
import type { SegmentTranscriber, TranscriptionJob } from '@codevo-whisper/audio';
import { ProtocolError } from '@codevo-whisper/protocol';
import type { GatewayContext } from './gateway-context';
import type { SttClient } from './stt-client';

export const BUSY_RETRY_DELAY_MS = 250;

function isBusy(error: unknown): boolean {
  return error instanceof ProtocolError && error.code === 'busy';
}

export class SttSegmentTranscriber implements SegmentTranscriber<GatewayContext> {
  constructor(private readonly client: SttClient) {}

  async transcribe(job: TranscriptionJob<GatewayContext>, signal: AbortSignal): Promise<string> {
    try {
      return await this.client.transcribe(job.pcm, job.context.language, signal);
    } catch (error) {
      if (!isBusy(error) || signal.aborted) {
        throw error;
      }
      await sleep(BUSY_RETRY_DELAY_MS, undefined, { signal });
      return this.client.transcribe(job.pcm, job.context.language, signal);
    }
  }
}
