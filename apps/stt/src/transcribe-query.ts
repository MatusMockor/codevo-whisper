import { LanguageSelection, type SegmentKind } from '@codevo-whisper/language-routing';
import { isVocabularyTerm, MAX_VOCABULARY_TERMS, type TranscribeLanguage } from '@codevo-whisper/stt-runner';

export type PlainQuery = { kind: 'plain'; language: TranscribeLanguage; vocabulary: readonly string[] };

export type RoutedQuery = { kind: 'routed'; selection: LanguageSelection; segment: SegmentKind; vocabulary: readonly string[] };

export type TranscribeQuery = PlainQuery | RoutedQuery | { kind: 'invalid' };

const LANGUAGES: readonly TranscribeLanguage[] = ['sk', 'en', 'cs', 'auto'];
const SEGMENT_KINDS: readonly SegmentKind[] = ['final', 'partial'];
const INVALID: TranscribeQuery = { kind: 'invalid' };

function plainQuery(language: string, vocabulary: readonly string[]): TranscribeQuery {
  const match = LANGUAGES.find((candidate) => candidate === language);
  if (match === undefined) {
    return INVALID;
  }
  return { kind: 'plain', language: match, vocabulary };
}

function routedQuery(language: string, codes: readonly string[], segment: SegmentKind, vocabulary: readonly string[]): TranscribeQuery {
  if (language !== 'auto' || !LanguageSelection.isValid(codes)) {
    return INVALID;
  }
  return { kind: 'routed', selection: LanguageSelection.of(codes), segment, vocabulary };
}

function isValidVocabulary(vocabulary: readonly string[]): boolean {
  return vocabulary.length <= MAX_VOCABULARY_TERMS && vocabulary.every(isVocabularyTerm);
}

export function parseTranscribeQuery(params: URLSearchParams): TranscribeQuery {
  const language = params.get('language') ?? '';
  const segment = SEGMENT_KINDS.find((candidate) => candidate === (params.get('kind') ?? 'final'));
  const vocabulary = params.getAll('vocabulary');
  if (segment === undefined || !isValidVocabulary(vocabulary)) {
    return INVALID;
  }
  const languages = params.get('languages');
  if (languages === null) {
    return plainQuery(language, vocabulary);
  }
  return routedQuery(language, languages.split(','), segment, vocabulary);
}
