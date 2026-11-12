import { FinalDecisionExecutor } from './execution/final-decision-executor';
import { PartialDecisionExecutor } from './execution/partial-decision-executor';
import type { DecisionExecutor } from './execution/routed-segment';
import { RoutingModels } from './execution/routing-models';
import { recoverUnlessAborted } from './execution/recover-unless-aborted';
import { LanguageScores } from './language-scores';
import { SUPPORTED_LANGUAGES, type LanguageScore } from './languages';
import { ConfidentRoutePolicy } from './policy/confident-route-policy';
import type { RoutePolicy, RouteSelection } from './policy/route-policy';
import type { ConditionedTranscriber, LanguageIdentifier, VerbatimTranscriber } from './ports';
import type { RoutedTranscript } from './route';
import { RoutingThresholds } from './routing-thresholds';
import { segmentMs } from './segment-duration';
import { OrthographyCheck } from './text/orthography-check';
import { TranslationGuard } from './text/translation-guard';

export type SegmentKind = 'final' | 'partial';

export type RoutedRequest = { pcm: Uint8Array; selection: RouteSelection; kind: SegmentKind; signal?: AbortSignal };

export type RoutingPorts = { identifier: LanguageIdentifier; conditioned: ConditionedTranscriber; verbatim: VerbatimTranscriber };

export type RoutingOptions = { thresholds?: RoutingThresholds; policy?: RoutePolicy };

export class RoutedTranscriber {
  private readonly identifier: LanguageIdentifier;
  private readonly models: RoutingModels;
  private readonly policy: RoutePolicy;
  private readonly executors: Readonly<Record<SegmentKind, DecisionExecutor>>;

  constructor(ports: RoutingPorts, options: RoutingOptions = {}) {
    const thresholds = options.thresholds ?? RoutingThresholds.fleurs();
    const orthography = new OrthographyCheck();
    this.identifier = ports.identifier;
    this.models = new RoutingModels(ports.conditioned, ports.verbatim);
    this.policy = options.policy ?? new ConfidentRoutePolicy(thresholds);
    this.executors = {
      final: new FinalDecisionExecutor(this.models, orthography, new TranslationGuard(orthography, thresholds)),
      partial: new PartialDecisionExecutor(this.models),
    };
  }

  async transcribe(request: RoutedRequest): Promise<RoutedTranscript> {
    const { pcm } = request;
    const signal = request.signal ?? new AbortController().signal;
    const screening = this.policy.screen(request.selection, segmentMs(pcm));
    if (screening.kind === 'verbatim') {
      return this.models.verbatim(pcm, screening.route, signal);
    }
    const rows = await recoverUnlessAborted<readonly LanguageScore[] | null>(this.identifier.identify({ pcm, allowed: SUPPORTED_LANGUAGES, signal }), signal, () => Promise.resolve(null));
    if (rows === null) {
      return this.models.verbatim(pcm, 'verbatim-fallback', signal);
    }
    const decision = this.policy.decide(screening.selection, LanguageScores.from(rows));
    if (decision.kind === 'verbatim') {
      return this.models.verbatim(pcm, decision.route, signal);
    }
    const segment = { pcm, selection: screening.selection, language: decision.language, signal };
    const executor = this.executors[request.kind];
    if (decision.kind === 'unsure') {
      return executor.unsure(segment);
    }
    return executor.confident(segment);
  }
}
