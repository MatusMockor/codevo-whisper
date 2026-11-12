import type { LanguageSelection } from '../language-selection';
import type { SupportedLanguage } from '../languages';
import type { RoutedTranscript } from '../route';

export type RoutedSegment = { pcm: Uint8Array; selection: LanguageSelection; language: SupportedLanguage; signal: AbortSignal };

export interface DecisionExecutor {
  unsure(segment: RoutedSegment): Promise<RoutedTranscript>;
  confident(segment: RoutedSegment): Promise<RoutedTranscript>;
}
