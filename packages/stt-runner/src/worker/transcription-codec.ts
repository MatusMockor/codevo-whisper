import { MAX_OUTPUT_BYTES, type TranscribeLanguage } from '../run-transcribe-cli';
import type { FrameCodec } from './frame-codec';
import { encodeWorkerRequest } from './worker-frames';

export type TranscriptionRequest = { pcm: Uint8Array; language: TranscribeLanguage; vocabulary?: readonly string[] };

export class TranscriptionCodec implements FrameCodec<TranscriptionRequest, string> {
  readonly maxReplyBytes = MAX_OUTPUT_BYTES;

  encode(request: TranscriptionRequest): Uint8Array {
    return encodeWorkerRequest(request.language, request.pcm, request.vocabulary);
  }

  decode(reply: string): string {
    return reply.trim();
  }
}
