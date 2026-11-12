import { LanguageSelection, type SegmentKind } from '@codevo-whisper/language-routing';
import type { TranscribeLanguage } from '@codevo-whisper/stt-runner';

export type PlainQuery = { kind: 'plain'; language: TranscribeLanguage };

export type RoutedQuery = { kind: 'routed'; selection: LanguageSelection; segment: SegmentKind };

export type TranscribeQuery = PlainQuery | RoutedQuery | { kind: 'invalid' };

const LANGUAGES: readonly TranscribeLanguage[] = ['sk', 'en', 'cs', 'auto'];
const SEGMENT_KINDS: readonly SegmentKind[] = ['final', 'partial'];
const INVALID: TranscribeQuery = { kind: 'invalid' };

function plainQuery(language: string): TranscribeQuery {
  const match = LANGUAGES.find((candidate) => candidate === language);
  if (match === undefined) {
    return INVALID;
  }
  return { kind: 'plain', language: match };
}

function routedQuery(language: string, codes: readonly string[], segment: SegmentKind): TranscribeQuery {
  if (language !== 'auto' || !LanguageSelection.isValid(codes)) {
    return INVALID;
  }
  return { kind: 'routed', selection: LanguageSelection.of(codes), segment };
}

export function parseTranscribeQuery(params: URLSearchParams): TranscribeQuery {
  const language = params.get('language') ?? '';
  const segment = SEGMENT_KINDS.find((candidate) => candidate === (params.get('kind') ?? 'final'));
  if (segment === undefined) {
    return INVALID;
  }
  const languages = params.get('languages');
  if (languages === null) {
    return plainQuery(language);
  }
  return routedQuery(language, languages.split(','), segment);
}
