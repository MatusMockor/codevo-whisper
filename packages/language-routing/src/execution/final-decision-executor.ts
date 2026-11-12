import type { SupportedLanguage } from '../languages';
import type { RoutedTranscript } from '../route';
import type { OrthographyCheck } from '../text/orthography-check';
import type { TranslationGuard } from '../text/translation-guard';
import type { DecisionExecutor, RoutedSegment } from './routed-segment';
import type { RoutingModels } from './routing-models';
import { recoverUnlessAborted } from './recover-unless-aborted';

export class FinalDecisionExecutor implements DecisionExecutor {
  constructor(
    private readonly models: RoutingModels,
    private readonly orthography: OrthographyCheck,
    private readonly guard: TranslationGuard,
  ) {}

  async unsure(segment: RoutedSegment): Promise<RoutedTranscript> {
    const { pcm, language, signal } = segment;
    const verbatim = await recoverUnlessAborted<RoutedTranscript | null>(this.models.verbatim(pcm, 'verbatim-unsure', signal), signal, () => Promise.resolve(null));
    if (verbatim === null) {
      return this.models.conditioned(pcm, language, 'conditioned', signal);
    }
    if (this.orthography.isConsistent(verbatim.text, segment.selection)) {
      return verbatim;
    }
    const fallback: RoutedTranscript = { text: verbatim.text, language: null, route: 'verbatim-fallback' };
    return recoverUnlessAborted(this.models.conditioned(pcm, language, 'conditioned-fix', signal), signal, () => Promise.resolve(fallback));
  }

  async confident(segment: RoutedSegment): Promise<RoutedTranscript> {
    const { conditioned, verbatim } = await this.models.both(segment.pcm, segment.language, segment.signal);
    if (segment.signal.aborted && (conditioned.status === 'rejected' || verbatim.status === 'rejected')) {
      throw segment.signal.reason;
    }
    if (conditioned.status === 'rejected') {
      return this.withoutConditioned(conditioned.reason, verbatim);
    }
    if (verbatim.status === 'rejected') {
      return this.conditionedResult(conditioned.value, segment.language);
    }
    if (!this.guard.accepts(conditioned.value, verbatim.value, segment.selection)) {
      return { text: verbatim.value, language: null, route: 'verbatim-guard' };
    }
    return this.conditionedResult(conditioned.value, segment.language);
  }

  private withoutConditioned(error: unknown, verbatim: PromiseSettledResult<string>): RoutedTranscript {
    if (verbatim.status === 'rejected') {
      throw error;
    }
    return { text: verbatim.value, language: null, route: 'verbatim-fallback' };
  }

  private conditionedResult(text: string, language: SupportedLanguage): RoutedTranscript {
    return { text, language, route: 'conditioned' };
  }
}
