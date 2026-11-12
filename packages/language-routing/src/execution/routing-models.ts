import type { SupportedLanguage } from '../languages';
import type { ConditionedTranscriber, VerbatimTranscriber } from '../ports';
import type { Route, RoutedTranscript } from '../route';

export type ParallelOutcome = { conditioned: PromiseSettledResult<string>; verbatim: PromiseSettledResult<string> };

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

  verbatimFallback(pcm: Uint8Array, signal: AbortSignal, conditionedError: unknown): Promise<RoutedTranscript> {
    return this.verbatim(pcm, 'verbatim-fallback', signal).catch((error: unknown) => {
      throw signal.aborted ? error : conditionedError;
    });
  }

  async both(pcm: Uint8Array, language: SupportedLanguage, signal: AbortSignal): Promise<ParallelOutcome> {
    const [conditioned, verbatim] = await Promise.allSettled([
      this.conditionedModel.transcribe({ pcm, language, signal }),
      this.verbatimModel.transcribe({ pcm, language: 'auto', signal }),
    ]);
    return { conditioned, verbatim };
  }
}
