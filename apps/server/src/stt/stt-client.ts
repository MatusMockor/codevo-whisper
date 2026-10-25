import type { Language } from '@codevo-whisper/protocol';

export interface SttClient {
  transcribe(pcm: Uint8Array, language: Language, signal: AbortSignal): Promise<string>;
}

export type SttHealth = 'UP' | 'DOWN' | 'BUSY';

export interface SttHealthCheck {
  health(): Promise<SttHealth>;
}
