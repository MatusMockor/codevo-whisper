import { ProtocolError, type ErrorCode, type Language } from '@codevo-whisper/protocol';
import { chunkAudio } from '../stt/chunk-audio';
import type { TranscriptionQueue } from '../stt/transcription-queue';
import type { SecureChannel } from './secure-channel';

export type DictationRequest = { deviceId: string; pcm: Uint8Array; language: Language; signal: AbortSignal };

export type DictationOutcome = { chunks: number; result: 'ok' | 'cancelled' | ErrorCode };

function errorCodeOf(error: unknown): ErrorCode {
  if (error instanceof ProtocolError) {
    return error.code;
  }
  return 'stt_unavailable';
}

export async function transcribeDictation(
  queue: TranscriptionQueue,
  channel: SecureChannel,
  request: DictationRequest,
): Promise<DictationOutcome> {
  const chunks = chunkAudio(request.pcm);
  try {
    for (const [segmentId, chunk] of chunks.entries()) {
      const text = await queue.enqueue(request.deviceId, chunk, request.language, request.signal);
      channel.send({ type: 'final', segmentId, text });
    }
    channel.send({ type: 'done' });
    return { chunks: chunks.length, result: 'ok' };
  } catch (error) {
    if (request.signal.aborted) {
      return { chunks: chunks.length, result: 'cancelled' };
    }
    const code = errorCodeOf(error);
    channel.send({ type: 'error', code, message: code });
    return { chunks: chunks.length, result: code };
  }
}
