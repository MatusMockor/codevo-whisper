import type { RoutedTranscript } from '../route';
import type { OrthographyCheck } from '../text/orthography-check';
import type { TranslationGuard } from '../text/translation-guard';
import type { DecisionExecutor, RoutedSegment } from './routed-segment';
import type { RoutingModels } from './routing-models';

export class FinalDecisionExecutor implements DecisionExecutor {
  constructor(
    private readonly models: RoutingModels,
    private readonly orthography: OrthographyCheck,
    private readonly guard: TranslationGuard,
  ) {}

  async unsure(segment: RoutedSegment): Promise<RoutedTranscript> {
    const verbatim = await this.models.verbatim(segment.pcm, 'verbatim-unsure', segment.signal);
    if (this.orthography.isConsistent(verbatim.text, segment.selection)) {
      return verbatim;
    }
    return this.models.conditioned(segment.pcm, segment.language, 'conditioned-fix', segment.signal);
  }

  async confident(segment: RoutedSegment): Promise<RoutedTranscript> {
    const texts = await this.models.both(segment.pcm, segment.language, segment.signal);
    if (!this.guard.accepts(texts.conditioned, texts.verbatim, segment.selection)) {
      return { text: texts.verbatim, language: null, route: 'verbatim-guard' };
    }
    return { text: texts.conditioned, language: segment.language, route: 'conditioned' };
  }
}
