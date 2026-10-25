import type { TranscribeLanguage } from '@codevo-whisper/stt-runner';

export interface Transcriber {
  transcribe(pcm: Uint8Array, language: TranscribeLanguage, signal: AbortSignal): Promise<string>;
}
