import type { LanguageSelection } from '../../shared/dictation-languages';
import type { EngineId } from '../../shared/settings';

export type EngineUnavailableReason =
  | 'no-model'
  | 'model-missing'
  | 'model-broken'
  | 'binary-missing'
  | 'languages-required'
  | 'languages-pack-missing'
  | 'server-not-paired'
  | 'server-offline'
  | 'server-repair-needed'
  | 'server-busy'
  | 'server-storage'
  | 'server-disconnected'
  | 'server-languages-outdated'
  | 'server-languages-missing';

export type EngineReadiness = { ready: boolean; reason?: EngineUnavailableReason };

export type TranscriptUpdate =
  | { type: 'partial'; segmentId: number; revision: number; text: string }
  | { type: 'final'; segmentId: number; text: string }
  | { type: 'restart' };

export type DictationOptions = { languages: LanguageSelection; vocabulary?: readonly string[]; signal: AbortSignal; partials?: boolean; onTranscript?: (update: TranscriptUpdate) => void };

export interface EngineDictation {
  push(pcm: Uint8Array): void;
  finish(): Promise<string>;
}

export type PreparedEngine = {
  readonly id: EngineId;
  start(options: DictationOptions): EngineDictation;
  release(): void;
};

export type Preparation = { ready: true; engine: PreparedEngine } | { ready: false; reason?: EngineUnavailableReason };

export interface TranscriptionEngine {
  readonly id: EngineId;
  prepare(selection?: LanguageSelection): Promise<Preparation>;
}

export class EngineUnavailableError extends Error {
  override readonly name = 'EngineUnavailableError';

  constructor(readonly reason: EngineUnavailableReason) {
    super(`Transcription engine is not ready: ${reason}`);
  }
}

export type EngineFailureReason = 'engine-failed' | 'busy' | 'stt-unavailable' | 'languages-outdated' | 'languages-missing' | 'too-long' | 'connection-lost' | 'repair-needed' | 'protocol' | 'disconnected';

export class TranscriptionFailedError extends Error {
  override readonly name = 'TranscriptionFailedError';

  constructor(
    readonly reason: EngineFailureReason,
    readonly textSoFar = '',
    options?: ErrorOptions,
  ) {
    super(`Transcription failed: ${reason}`, options);
  }
}

export function notReady(reason: EngineUnavailableReason | undefined): Preparation {
  if (reason === undefined) {
    return { ready: false };
  }
  return { ready: false, reason };
}
