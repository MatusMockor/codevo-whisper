import { TranscriptionDispatcher, type Clock } from '@codevo-whisper/audio';
import type { ResidentTranscriber, TranscribeBackend } from '@codevo-whisper/stt-runner';
import { LocalDictation } from './local-dictation';
import { vocabularyOf, warmUpSilence, type GenerationSession, type GenerationSpec, type LocalGeneration } from './local-generation';
import type { LocalResidents } from './local-residents';
import type { ReadyLanguagePlan } from './local-language';
import { ResidentSegmentTranscriber, type LocalContext } from './resident-segment-transcriber';
import type { EngineDictation } from './transcription-engine';

export class DirectGeneration implements LocalGeneration {
  readonly spec: GenerationSpec;
  readonly backend: TranscribeBackend;
  readonly retired = new AbortController();
  readonly startup: Promise<void>;
  warmed = false;
  private readonly resident: ResidentTranscriber;
  private readonly dispatcher: TranscriptionDispatcher<LocalContext>;

  constructor(model: string, residents: LocalResidents, clock: Clock) {
    this.spec = { kind: 'direct', model };
    this.backend = residents.backend;
    this.resident = residents.transcriber(model);
    this.startup = this.resident.warmUp();
    this.dispatcher = new TranscriptionDispatcher<LocalContext>({ transcriber: new ResidentSegmentTranscriber(this.resident, this.startup), clock });
  }

  dictation(plan: ReadyLanguagePlan, session: GenerationSession): EngineDictation | null {
    if (plan.kind !== 'direct') {
      return null;
    }
    return new LocalDictation({ ...session, dispatcher: this.dispatcher, context: { hint: plan.hint, ...vocabularyOf(session.options) } });
  }

  async warmUp(): Promise<void> {
    await this.startup;
    await this.resident.transcribe({ pcm: warmUpSilence(), language: 'en', signal: this.retired.signal });
  }

  close(): Promise<void> {
    return this.resident.close();
  }
}
