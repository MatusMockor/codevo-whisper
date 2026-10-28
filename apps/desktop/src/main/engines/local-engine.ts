import { systemClock, TranscriptionDispatcher, type Clock, type SegmentConfig } from '@codevo-whisper/audio';
import { ResidentTranscriber } from '@codevo-whisper/stt-runner';
import { access, constants } from 'node:fs/promises';
import type { SettingsStore } from '../settings/settings-store';
import type { Settings } from '../../shared/settings';
import { PCM_BYTES_PER_SECOND } from '../../shared/pcm';
import { consoleLogger } from '../logging/logger';
import type { ActiveModel } from './active-model';
import { localBackend, localThreads, type LocalEngineArch } from './local-backend';
import { LocalDictation } from './local-dictation';
import { ResidentSegmentTranscriber, type LocalContext } from './resident-segment-transcriber';
import { notReady, type EngineReadiness, type Preparation, type TranscriptionEngine } from './transcription-engine';

const VERIFICATION_REASON = { missing: 'model-missing', broken: 'model-broken' } as const;
export const LOCAL_CALL_TIMEOUT_MS = 60_000;

export type LocalEngineDeps = {
  binary: string;
  models: ActiveModel;
  settings: Pick<SettingsStore, 'get' | 'onChange'>;
  arch: LocalEngineArch;
  platform?: NodeJS.Platform;
  clock?: Clock;
  callTimeoutMs?: number;
  segment?: Partial<SegmentConfig>;
};

type Generation = {
  warmed: boolean;
  backend: ReturnType<typeof localBackend>;
  retired: AbortController;
  resident: ResidentTranscriber;
  startup: Promise<void>;
  dispatcher: TranscriptionDispatcher<LocalContext>;
};
type Lease = { released: boolean; revision: number };

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
  private generation: Generation | undefined;
  private readonly leases = new Set<Lease>();
  private disposed = false;
  private revision = 0;
  private shutdown: Promise<void> = Promise.resolve();
  private recordingEnded = false;
  private anchor: number | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: LocalEngineDeps) {
    this.clock = deps.clock ?? systemClock;
    this.unsubscribe = deps.settings.onChange((next, previous) => {
      if (next.localModelId !== previous.localModelId) {
        this.revision += 1;
        this.anchor = undefined;
        this.recordingEnded = false;
        void this.close().catch((error: unknown) => consoleLogger.error('Local worker shutdown failed', error));
        return;
      }
      this.scheduleIdle();
    });
  }

  private acquire(model: string): Generation {
    if (this.generation !== undefined) return this.generation;
    const backend = this.backend();
    const resident = new ResidentTranscriber({
      binary: this.deps.binary,
      model,
      backend,
      threads: localThreads(),
      timeoutMs: this.deps.callTimeoutMs ?? LOCAL_CALL_TIMEOUT_MS,
      startupTimeoutMs: this.deps.callTimeoutMs ?? LOCAL_CALL_TIMEOUT_MS,
    });
    const startup = resident.warmUp();
    const dispatcher = new TranscriptionDispatcher<LocalContext>({ transcriber: new ResidentSegmentTranscriber(resident, startup), clock: this.clock });
    this.anchor ??= this.clock.now();
    const generation: Generation = { warmed: false, backend, retired: new AbortController(), resident, startup, dispatcher };
    this.generation = generation;
    void startup.catch((error: unknown) => {
      if (this.generation !== generation) return;
      this.clearIdle();
      this.generation = undefined;
      this.shutdown = Promise.all([this.shutdown, resident.close()]).then(() => undefined);
      void this.shutdown.catch((failure: unknown) => consoleLogger.error('Local worker shutdown failed', failure));
      consoleLogger.error('Local model could not start', error);
    });
    return generation;
  }

  dispose(): Promise<void> {
    this.disposed = true;
    this.revision += 1;
    this.unsubscribe();
    return this.close();
  }

  private close(): Promise<void> {
    this.clearIdle();
    const generation = this.generation;
    this.generation = undefined;
    const closing = generation?.resident.close();
    generation?.retired.abort();
    this.shutdown = Promise.all([this.shutdown, closing]).then(() => undefined);
    return this.shutdown;
  }

  private reserve(): Lease {
    this.clearIdle();
    const lease = { released: false, revision: this.revision };
    this.leases.add(lease);
    return lease;
  }

  private release(lease: Lease): void {
    if (lease.released) return;
    lease.released = true;
    this.leases.delete(lease);
    this.scheduleIdle();
  }

  private clearIdle(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private scheduleIdle(): void {
    this.clearIdle();
    if (this.disposed || this.generation === undefined || [...this.leases].some((lease) => lease.revision === this.revision)) return;
    if (this.generation.backend !== this.backend()) {
      void this.close().catch((error: unknown) => consoleLogger.error('Local worker shutdown failed', error));
      return;
    }
    const policy = this.deps.settings.get().localModelUnload;
    if (policy === 'never') return;
    const remaining = policy === 'immediately' ? 0 : (this.anchor ?? this.clock.now()) + policy * 60_000 - this.clock.now();
    if (remaining <= 0) {
      void this.close().catch((error: unknown) => consoleLogger.error('Local worker shutdown failed', error));
      return;
    }
    this.idleTimer = setTimeout(() => this.scheduleIdle(), remaining);
  }

  async isReady(): Promise<EngineReadiness> {
    if (!(await isExecutable(this.deps.binary))) return { ready: false, reason: 'binary-missing' };
    if ((await this.deps.models.activeModelPath()) === null) return { ready: false, reason: 'no-model' };
    const verification = await this.deps.models.verifyActive();
    if (verification !== 'ok') return { ready: false, reason: VERIFICATION_REASON[verification] };
    if (this.needsLanguage(this.deps.settings.get().language)) return { ready: false, reason: 'language-required' };
    return { ready: true };
  }

  async prepare(): Promise<Preparation> {
    const lease = this.reserve();
    let transferred = false;
    try {
      const readiness = await this.isReady();
      if (!readiness.ready) return notReady(readiness.reason);
      const model = await this.deps.models.activeModelPath();
      await this.shutdown;
      if (model === null || this.disposed || lease.revision !== this.revision) return notReady('no-model');
      const generation = this.acquire(model);
      let state: 'prepared' | 'started' | 'released' = 'prepared';
      transferred = true;
      return {
        ready: true,
        engine: {
          id: this.id,
          start: (options) => {
            if (state !== 'prepared' || this.disposed || generation !== this.generation) {
              if (state === 'prepared') {
                state = 'released';
                this.release(lease);
              }
              throw new Error('Local preparation is no longer available');
            }
            state = 'started';
            return new LocalDictation({
              dispatcher: generation.dispatcher,
              clock: this.clock,
              context: { language: options.language, ...(options.vocabulary === undefined ? {} : { vocabulary: options.vocabulary }) },
              options: { ...options, signal: AbortSignal.any([options.signal, generation.retired.signal]) },
              onRecordingEnd: () => {
                if (lease.revision !== this.revision) return;
                this.recordingEnded = true;
                this.anchor = Math.max(this.anchor ?? 0, this.clock.now());
              },
              onTerminal: () => this.release(lease),
              ...(this.deps.segment === undefined ? {} : { segment: this.deps.segment }),
            });
          },
          release: () => {
            if (state !== 'prepared') return;
            state = 'released';
            this.release(lease);
          },
        },
      };
    } finally {
      if (!transferred) this.release(lease);
    }
  }

  async warmUp(modelPath: string): Promise<void> {
    const lease = this.reserve();
    try {
      if (this.disposed || !(await isExecutable(this.deps.binary)) || (await this.deps.models.activeModelPath()) !== modelPath || (await this.deps.models.verifyActive()) !== 'ok') {
        throw new Error('Warm-up model is unavailable');
      }
      await this.shutdown;
      if (lease.revision !== this.revision || this.disposed) throw new Error('Warm-up selection changed');
      const generation = this.acquire(modelPath);
      await generation.startup;
      await generation.resident.transcribe({ pcm: new Uint8Array(PCM_BYTES_PER_SECOND), language: 'en', signal: generation.retired.signal });
      const selectedPath = await this.deps.models.activeModelPath();
      if (lease.revision !== this.revision || generation !== this.generation || selectedPath !== modelPath) {
        throw new Error('Warm-up selection changed');
      }
      if (!generation.warmed && !this.recordingEnded) this.anchor = this.clock.now();
      generation.warmed = true;
    } finally {
      this.release(lease);
    }
  }

  private backend(): ReturnType<typeof localBackend> {
    return localBackend(this.deps.arch, this.deps.settings.get().localAcceleration, this.deps.platform);
  }

  private needsLanguage(language: Settings['language']): boolean {
    return language === 'auto' && this.deps.models.activeLanguageHint() === 'required';
  }
}
