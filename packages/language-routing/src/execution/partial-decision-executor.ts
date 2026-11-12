import type { RoutedTranscript } from '../route';
import { recoverUnlessAborted } from './recover-unless-aborted';
import type { DecisionExecutor, RoutedSegment } from './routed-segment';
import type { RoutingModels } from './routing-models';

export class PartialDecisionExecutor implements DecisionExecutor {
  constructor(private readonly models: RoutingModels) {}

  unsure({ pcm, language, signal }: RoutedSegment): Promise<RoutedTranscript> {
    return recoverUnlessAborted(this.models.verbatim(pcm, 'verbatim-unsure', signal), signal, () => this.models.conditioned(pcm, language, 'conditioned', signal));
  }

  confident({ pcm, language, signal }: RoutedSegment): Promise<RoutedTranscript> {
    return recoverUnlessAborted(this.models.conditioned(pcm, language, 'conditioned', signal), signal, (error) => this.models.verbatimFallback(pcm, signal, error));
  }
}
