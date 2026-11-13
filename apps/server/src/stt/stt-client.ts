import type { JobKind } from '@codevo-whisper/audio';
import type { DictationLanguage, Language } from '@codevo-whisper/protocol';

export type SttRequest = {
  pcm: Uint8Array;
  language: Language;
  languages: readonly DictationLanguage[] | null;
  kind: JobKind;
  vocabulary: readonly string[];
};

export type SttTranscript = { text: string; language: DictationLanguage | null; route: string | null };

export interface SttClient {
  transcribe(request: SttRequest, signal: AbortSignal): Promise<SttTranscript>;
}

export type SttHealth = 'UP' | 'DOWN' | 'BUSY';

export interface SttHealthCheck {
  health(): Promise<SttHealth>;
}
