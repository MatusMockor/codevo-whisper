import type { EngineId, Settings } from '../../shared/settings';

export type EngineUnavailableReason = 'no-model' | 'model-missing' | 'model-broken' | 'binary-missing' | 'language-required';

export type EngineReadiness = { ready: boolean; reason?: EngineUnavailableReason };

export interface TranscriptionEngine {
  readonly id: EngineId;
  isReady(): Promise<EngineReadiness>;
  transcribe(pcm: Uint8Array, language: Settings['language'], signal: AbortSignal): Promise<string>;
}

export class EngineUnavailableError extends Error {
  override readonly name = 'EngineUnavailableError';

  constructor(readonly reason: EngineUnavailableReason) {
    super(`Transcription engine is not ready: ${reason}`);
  }
}
