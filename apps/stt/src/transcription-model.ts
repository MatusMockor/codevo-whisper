import type { TranscriptionJob } from './transcription-job';
import type { ValidQuery } from './transcribe-query';

export const PARAKEET_ULTRA = 'parakeet-ultra';

export const WHISPER_LARGE_V3 = 'whisper-large-v3';

export type TranscriptionModelReport = { id: string; name: string; available: boolean; default: boolean };

export interface TranscriptionModel {
  readonly id: string;
  readonly name: string;
  available(): boolean;
  ready(): boolean;
  prepare(): Promise<void>;
  jobFor(query: ValidQuery): TranscriptionJob | null;
}
