import type { TranscribeLanguage } from '@codevo-whisper/stt-runner';
import type { EngineComponent } from './engine-component';

export type TranscriberCall = { pcm: Uint8Array; language: TranscribeLanguage; signal?: AbortSignal };

export interface Transcriber extends EngineComponent {
  transcribe(call: TranscriberCall): Promise<string>;
}
