import { systemClock, TranscriptionDispatcher, type Clock, type SegmentConfig } from '@codevo-whisper/audio';
import { access, constants } from 'node:fs/promises';
import type { SettingsStore } from '../settings/settings-store';
import type { Settings } from '../../shared/settings';
import type { ActiveModel } from './active-model';
import { localBackend, localThreads, type LocalEngineArch } from './local-backend';
import { LocalDictation } from './local-dictation';
import { TranscribeCliTranscriber, type LocalContext } from './transcribe-cli-transcriber';
import { notReady, type DictationOptions, type EngineReadiness, type Preparation, type TranscriptionEngine } from './transcription-engine';

const VERIFICATION_REASON = { missing: 'model-missing', broken: 'model-broken' } as const;

export const LOCAL_CALL_TIMEOUT_MS = 60_000;

export type LocalEngineDeps = {
  binary: string;
  models: ActiveModel;
  settings: Pick<SettingsStore, 'get'>;
  arch: LocalEngineArch;
  clock?: Clock;
  callTimeoutMs?: number;
  segment?: Partial<SegmentConfig>;
};

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export class LocalEngine implements TranscriptionEngine {
  readonly id = 'local' as const;

  private readonly clock: Clock;
  private readonly dispatcher: TranscriptionDispatcher<LocalContext>;

  constructor(private readonly deps: LocalEngineDeps) {
    this.clock = deps.clock ?? systemClock;
    this.dispatcher = new TranscriptionDispatcher<LocalContext>({
      transcriber: new TranscribeCliTranscriber({
        binary: deps.binary,
        backend: localBackend(deps.arch),
        threads: localThreads(),
        timeoutMs: deps.callTimeoutMs ?? LOCAL_CALL_TIMEOUT_MS,
      }),
      clock: this.clock,
    });
  }

  async isReady(): Promise<EngineReadiness> {
    if (!(await isExecutable(this.deps.binary))) {
      return { ready: false, reason: 'binary-missing' };
    }
    if ((await this.deps.models.activeModelPath()) === null) {
      return { ready: false, reason: 'no-model' };
    }
    const verification = await this.deps.models.verifyActive();
    if (verification !== 'ok') {
      return { ready: false, reason: VERIFICATION_REASON[verification] };
    }
    if (this.needsLanguage(this.deps.settings.get().language)) {
      return { ready: false, reason: 'language-required' };
    }
    return { ready: true };
  }

  async prepare(): Promise<Preparation> {
    const readiness = await this.isReady();
    if (!readiness.ready) {
      return notReady(readiness.reason);
    }
    const model = await this.deps.models.activeModelPath();
    if (model === null) {
      return notReady('no-model');
    }
    return {
      ready: true,
      engine: {
        id: this.id,
        start: (options) => this.start(options, model),
        release: () => undefined,
      },
    };
  }

  private start(options: DictationOptions, model: string): LocalDictation {
    return new LocalDictation({
      dispatcher: this.dispatcher,
      clock: this.clock,
      context: { language: options.language, model },
      options,
      ...(this.deps.segment === undefined ? {} : { segment: this.deps.segment }),
    });
  }

  private needsLanguage(language: Settings['language']): boolean {
    return language === 'auto' && this.deps.models.activeLanguageHint() === 'required';
  }
}
