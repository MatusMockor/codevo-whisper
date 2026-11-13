import { setTimeout as sleep } from 'node:timers/promises';
import type { SegmentTranscriber, TranscriptionJob } from '@codevo-whisper/audio';
import { ProtocolError } from '@codevo-whisper/protocol';
import type { GatewayContext } from './gateway-context';
import type { SttClient, SttRequest, SttTranscript } from './stt-client';

export const BUSY_RETRY_DELAY_MS = 250;

function isBusy(error: unknown): boolean {
  return error instanceof ProtocolError && error.code === 'busy';
}

function requestOf(job: TranscriptionJob<GatewayContext>): SttRequest {
  const { language, languages, vocabulary } = job.context;
  return { pcm: job.pcm, language, languages, kind: job.kind, vocabulary };
}

export class SttSegmentTranscriber implements SegmentTranscriber<GatewayContext> {
  constructor(private readonly client: SttClient) {}

  async transcribe(job: TranscriptionJob<GatewayContext>, signal: AbortSignal): Promise<string> {
    const transcript = await this.send(requestOf(job), signal);
    job.context.observer.observe(job, transcript);
    return transcript.text;
  }

  private async send(request: SttRequest, signal: AbortSignal): Promise<SttTranscript> {
    try {
      return await this.client.transcribe(request, signal);
    } catch (error) {
      if (!isBusy(error) || signal.aborted) {
        throw error;
      }
      await sleep(BUSY_RETRY_DELAY_MS, undefined, { signal });
      return this.client.transcribe(request, signal);
    }
  }
}
