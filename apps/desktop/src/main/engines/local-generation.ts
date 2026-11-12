import type { Clock, SegmentConfig } from '@codevo-whisper/audio';
import type { TranscribeBackend } from '@codevo-whisper/stt-runner';
import type { LanguagePackPaths } from '../models/language-pack';
import { PCM_BYTES_PER_SECOND } from '../../shared/pcm';
import type { ReadyLanguagePlan } from './local-language';
import type { DictationOptions, EngineDictation } from './transcription-engine';

export type GenerationSpec = { kind: 'direct'; model: string } | { kind: 'routed'; model: string; pack: LanguagePackPaths };

export type GenerationSession = {
  clock: Clock;
  options: DictationOptions;
  segment?: Partial<SegmentConfig>;
  onRecordingEnd: () => void;
  onTerminal: () => void;
};

export interface LocalGeneration {
  readonly spec: GenerationSpec;
  readonly backend: TranscribeBackend;
  readonly retired: AbortController;
  readonly startup: Promise<void>;
  warmed: boolean;
  dictation(plan: ReadyLanguagePlan, session: GenerationSession): EngineDictation | null;
  warmUp(): Promise<void>;
  close(): Promise<void>;
}

export function sameSpec(left: GenerationSpec, right: GenerationSpec): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function warmUpSilence(): Uint8Array {
  return new Uint8Array(PCM_BYTES_PER_SECOND);
}

export function vocabularyOf(options: DictationOptions): { vocabulary?: readonly string[] } {
  return options.vocabulary === undefined ? {} : { vocabulary: options.vocabulary };
}
