import type { LanguageScore, SupportedLanguage } from './languages';

export type IdentificationRequest = { pcm: Uint8Array; allowed: readonly SupportedLanguage[]; signal?: AbortSignal };

export type ConditionedRequest = { pcm: Uint8Array; language: SupportedLanguage; signal?: AbortSignal };

export type VerbatimRequest = { pcm: Uint8Array; language: 'auto'; signal?: AbortSignal };

export interface LanguageIdentifier {
  identify(request: IdentificationRequest): Promise<readonly LanguageScore[]>;
}

export interface ConditionedTranscriber {
  transcribe(request: ConditionedRequest): Promise<string>;
}

export interface VerbatimTranscriber {
  transcribe(request: VerbatimRequest): Promise<string>;
}
