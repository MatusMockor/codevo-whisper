import type { SegmentTranscriber, TranscriptionJob } from '@codevo-whisper/audio';
import { RoutedTranscriber, type ConditionedRequest, type ConditionedTranscriber, type RouteSelection, type VerbatimRequest, type VerbatimTranscriber } from '@codevo-whisper/language-routing';
import type { ResidentLanguageIdentifier, ResidentTranscriber } from '@codevo-whisper/stt-runner';
import { skippedJob } from './resident-segment-transcriber';

export type RoutedContext = { selection: RouteSelection; vocabulary?: readonly string[] };

export type RoutedResidents = { verbatim: ResidentTranscriber; conditioned: ResidentTranscriber; identifier: ResidentLanguageIdentifier };

type SegmentModel = ConditionedTranscriber & VerbatimTranscriber;

function withVocabulary(resident: ResidentTranscriber, vocabulary: readonly string[] | undefined): SegmentModel {
  if (vocabulary === undefined) {
    return resident;
  }
  return { transcribe: (request: ConditionedRequest | VerbatimRequest) => resident.transcribe({ ...request, vocabulary }) };
}

export class RoutedSegmentTranscriber implements SegmentTranscriber<RoutedContext> {
  constructor(
    private readonly residents: RoutedResidents,
    private readonly startup: Promise<void>,
  ) {}

  transcribe(job: TranscriptionJob<RoutedContext>, signal: AbortSignal): Promise<string> {
    const skipped = skippedJob(job.pcm, signal);
    if (skipped !== null) {
      return skipped;
    }
    const { selection, vocabulary } = job.context;
    return this.startup.then(async () => (await this.router(vocabulary).transcribe({ pcm: job.pcm, selection, kind: job.kind, signal })).text);
  }

  private router(vocabulary: readonly string[] | undefined): RoutedTranscriber {
    const { verbatim, conditioned, identifier } = this.residents;
    return new RoutedTranscriber({ identifier, conditioned: withVocabulary(conditioned, vocabulary), verbatim: withVocabulary(verbatim, vocabulary) });
  }
}
