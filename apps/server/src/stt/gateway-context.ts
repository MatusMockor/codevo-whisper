import type { TranscriptionDispatcher, TranscriptionJob } from '@codevo-whisper/audio';
import type { DictationLanguage, Language } from '@codevo-whisper/protocol';
import type { SttTranscript } from './stt-client';

export type SegmentKey = Pick<TranscriptionJob<unknown>, 'kind' | 'segmentId' | 'revision'>;

export interface TranscriptObserver {
  observe(key: SegmentKey, transcript: SttTranscript): void;
}

export type GatewayContext = {
  language: Language;
  languages: readonly DictationLanguage[] | null;
  vocabulary: readonly string[];
  observer: TranscriptObserver;
};

export type GatewayDispatcher = TranscriptionDispatcher<GatewayContext>;
