import { SUPPORTED_LANGUAGES, type RoutedRequest, type RoutedTranscriber, type RoutedTranscript, type SupportedLanguage } from '@codevo-whisper/language-routing';
import type { EngineComponent } from './engine-component';

export interface LanguageRouter {
  languages(): readonly SupportedLanguage[];
  transcribe(request: RoutedRequest): Promise<RoutedTranscript>;
}

export class UnavailableLanguageRouter implements LanguageRouter {
  languages(): readonly SupportedLanguage[] {
    return [];
  }

  transcribe(): Promise<RoutedTranscript> {
    return Promise.reject(new Error('language routing is unavailable'));
  }
}

export class ModelLanguageRouter implements LanguageRouter {
  private warmedUp = false;

  constructor(
    private readonly routed: RoutedTranscriber,
    private readonly workers: readonly EngineComponent[],
  ) {}

  languages(): readonly SupportedLanguage[] {
    this.warmedUp ||= this.workers.every((worker) => worker.ready());
    if (!this.warmedUp) {
      return [];
    }
    return SUPPORTED_LANGUAGES;
  }

  transcribe(request: RoutedRequest): Promise<RoutedTranscript> {
    return this.routed.transcribe(request);
  }
}
