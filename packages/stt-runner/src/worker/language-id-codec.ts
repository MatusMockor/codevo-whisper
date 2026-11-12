import type { LanguageCode, LanguageScore } from '../languages';
import type { FrameCodec } from './frame-codec';
import { encodeLanguageIdRequest, MAX_LANGUAGE_ID_REPLY_BYTES, parseLanguageIdReply } from './langid-frames';

export type LanguageIdRequest = { pcm: Uint8Array; allowed: readonly LanguageCode[] };

export class LanguageIdCodec implements FrameCodec<LanguageIdRequest, LanguageScore[]> {
  readonly maxReplyBytes = MAX_LANGUAGE_ID_REPLY_BYTES;

  encode(request: LanguageIdRequest): Uint8Array {
    return encodeLanguageIdRequest(request.allowed, request.pcm);
  }

  decode(reply: string, request: LanguageIdRequest): LanguageScore[] {
    return parseLanguageIdReply(reply, request.allowed);
  }
}
