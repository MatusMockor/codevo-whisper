import type { SupportedLanguage } from '../languages';
import type { ConditionedTranscriber, VerbatimTranscriber } from '../ports';
import type { Route, RoutedTranscript } from '../route';

export type ParallelTexts = { conditioned: string; verbatim: string };

export class RoutingModels {
  constructor(
    private readonly conditionedModel: ConditionedTranscriber,
    private readonly verbatimModel: VerbatimTranscriber,
  ) {}

  async verbatim(pcm: Uint8Array, route: Route, signal: AbortSignal): Promise<RoutedTranscript> {
    const text = await this.verbatimModel.transcribe({ pcm, language: 'auto', signal });
    return { text, language: null, route };
  }

  async conditioned(pcm: Uint8Array, language: SupportedLanguage, route: Route, signal: AbortSignal): Promise<RoutedTranscript> {
    const text = await this.conditionedModel.transcribe({ pcm, language, signal });
    return { text, language, route };
  }

  async both(pcm: Uint8Array, language: SupportedLanguage, signal: AbortSignal): Promise<ParallelTexts> {
    const sibling = new AbortController();
    const linked = AbortSignal.any([signal, sibling.signal]);
    const abortSibling = (error: unknown): never => {
      sibling.abort(error);
      throw error;
    };
    const [conditioned, verbatim] = await Promise.all([
      this.conditionedModel.transcribe({ pcm, language, signal: linked }).catch(abortSibling),
      this.verbatimModel.transcribe({ pcm, language: 'auto', signal: linked }).catch(abortSibling),
    ]);
    return { conditioned, verbatim };
  }
}
