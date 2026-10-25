import { MAX_TEXT_CHARS, ProtocolError, type ErrorCode, type Language } from '@codevo-whisper/protocol';
import { chunkAudio } from '../stt/chunk-audio';
import type { TranscriptionQueue } from '../stt/transcription-queue';
import type { SecureChannel } from './secure-channel';

export type DictationRequest = { deviceId: string; sessionId: string; pcm: Uint8Array; language: Language; signal: AbortSignal };

export type DictationOutcome = { chunks: number; result: 'ok' | 'cancelled' | ErrorCode };

function limitText(text: string): string {
  const characters = [...text];
  if (characters.length <= MAX_TEXT_CHARS) {
    return text;
  }
  return characters.slice(0, MAX_TEXT_CHARS).join('');
}

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
      channel.send({ type: 'final', sessionId: request.sessionId, segmentId, text: limitText(text) });
    }
    channel.send({ type: 'done', sessionId: request.sessionId });
    return { chunks: chunks.length, result: 'ok' };
  } catch (error) {
    if (request.signal.aborted) {
      return { chunks: chunks.length, result: 'cancelled' };
    }
    const code = errorCodeOf(error);
    channel.send({ type: 'error', code, message: code, sessionId: request.sessionId });
    return { chunks: chunks.length, result: code };
  }
}
