import { TranscriptionDispatcher, type Clock } from '@codevo-whisper/audio';
import { LanguageSelection, type RouteSelection } from '@codevo-whisper/language-routing';
import type { TranscribeBackend } from '@codevo-whisper/stt-runner';
import type { LanguagePackPaths } from '../models/language-pack';
import { LocalDictation } from './local-dictation';
import { vocabularyOf, warmUpSilence, type GenerationSession, type GenerationSpec, type LocalGeneration } from './local-generation';
import type { LocalResidents } from './local-residents';
import type { ReadyLanguagePlan } from './local-language';
import { RoutedSegmentTranscriber, type RoutedContext, type RoutedResidents } from './routed-segment-transcriber';
import type { EngineDictation } from './transcription-engine';

function routeSelection(plan: ReadyLanguagePlan): RouteSelection | null {
  if (plan.kind === 'routed') {
    return LanguageSelection.of(plan.selected);
  }
  return plan.hint === 'auto' ? 'auto' : null;
}

export class RoutedGeneration implements LocalGeneration {
  readonly spec: GenerationSpec;
  readonly backend: TranscribeBackend;
  readonly retired = new AbortController();
  readonly startup: Promise<void>;
  warmed = false;
  private readonly residents: RoutedResidents;
  private readonly dispatcher: TranscriptionDispatcher<RoutedContext>;

  constructor(model: string, pack: LanguagePackPaths, residents: LocalResidents, clock: Clock) {
    this.spec = { kind: 'routed', model, pack };
    this.backend = residents.backend;
    this.residents = { verbatim: residents.transcriber(model), conditioned: residents.transcriber(pack.conditioned), identifier: residents.identifier(pack.languageId) };
    const { verbatim, conditioned, identifier } = this.residents;
    this.startup = Promise.all([verbatim.warmUp(), conditioned.warmUp(), identifier.warmUp()]).then(() => undefined);
    this.dispatcher = new TranscriptionDispatcher<RoutedContext>({ transcriber: new RoutedSegmentTranscriber(this.residents, this.startup), clock });
  }

  dictation(plan: ReadyLanguagePlan, session: GenerationSession): EngineDictation | null {
    const selection = routeSelection(plan);
    if (selection === null) {
      return null;
    }
    return new LocalDictation({ ...session, dispatcher: this.dispatcher, context: { selection, ...vocabularyOf(session.options) } });
  }

  async warmUp(): Promise<void> {
    await this.startup;
    const signal = this.retired.signal;
    await Promise.all([
      this.residents.verbatim.transcribe({ pcm: warmUpSilence(), language: 'auto', signal }),
      this.residents.conditioned.transcribe({ pcm: warmUpSilence(), language: 'en', signal }),
    ]);
  }

  async close(): Promise<void> {
    const { verbatim, conditioned, identifier } = this.residents;
    await Promise.all([verbatim.close(), conditioned.close(), identifier.close()]);
  }
}
