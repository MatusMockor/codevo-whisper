import type { Language } from '@codevo-whisper/protocol';

export type TranscriptionJob = {
  deviceId: string;
  pcm: Uint8Array;
  language: Language;
  controller: AbortController;
  signal: AbortSignal | undefined;
  resolve(text: string): void;
  reject(error: unknown): void;
  dispose(): void;
};

export function abortError(): DOMException {
  return new DOMException('The transcription was cancelled.', 'AbortError');
}
