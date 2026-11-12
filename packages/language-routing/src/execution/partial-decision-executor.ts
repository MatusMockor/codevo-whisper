import type { RoutedTranscript } from '../route';
import type { DecisionExecutor, RoutedSegment } from './routed-segment';
import type { RoutingModels } from './routing-models';

export class PartialDecisionExecutor implements DecisionExecutor {
  constructor(private readonly models: RoutingModels) {}

  unsure(segment: RoutedSegment): Promise<RoutedTranscript> {
    return this.models.verbatim(segment.pcm, 'verbatim-unsure', segment.signal);
  }

  confident(segment: RoutedSegment): Promise<RoutedTranscript> {
    return this.models.conditioned(segment.pcm, segment.language, 'conditioned', segment.signal);
  }
}
