import {
  RoutedTranscriber,
  SUPPORTED_LANGUAGES,
  type ConditionedRequest,
  type ConditionedTranscriber,
  type RoutedRequest,
  type RoutedTranscript,
  type SupportedLanguage,
  type VerbatimRequest,
  type VerbatimTranscriber,
} from '@codevo-whisper/language-routing';
import type { LanguageIdRunner } from './language-id-runner';
import type { Transcriber } from './transcriber';

export interface LanguageRouter {
  languages(): readonly SupportedLanguage[];
  transcribe(request: RoutedRequest, vocabulary: readonly string[]): Promise<RoutedTranscript>;
}

export type RoutingWorkers = { identifier: LanguageIdRunner; conditioned: Transcriber; verbatim: Transcriber };

export class UnavailableLanguageRouter implements LanguageRouter {
  languages(): readonly SupportedLanguage[] {
    return [];
  }

  transcribe(): Promise<RoutedTranscript> {
    return Promise.reject(new Error('language routing is unavailable'));
  }
}

function withVocabulary(model: Transcriber, vocabulary: readonly string[]): ConditionedTranscriber & VerbatimTranscriber {
  return { transcribe: (request: ConditionedRequest | VerbatimRequest) => model.transcribe({ ...request, vocabulary }) };
}

export class ModelLanguageRouter implements LanguageRouter {
  private warmedUp = false;

  constructor(private readonly workers: RoutingWorkers) {}

  languages(): readonly SupportedLanguage[] {
    const { identifier, conditioned, verbatim } = this.workers;
    this.warmedUp ||= [verbatim, conditioned, identifier].every((worker) => worker.ready());
    if (!this.warmedUp) {
      return [];
    }
    return SUPPORTED_LANGUAGES;
  }

  transcribe(request: RoutedRequest, vocabulary: readonly string[]): Promise<RoutedTranscript> {
    const { identifier, conditioned, verbatim } = this.workers;
    return new RoutedTranscriber({ identifier, conditioned: withVocabulary(conditioned, vocabulary), verbatim: withVocabulary(verbatim, vocabulary) }).transcribe(request);
  }
}
