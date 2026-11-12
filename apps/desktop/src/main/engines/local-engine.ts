import { systemClock, type Clock, type SegmentConfig } from '@codevo-whisper/audio';
import { access, constants } from 'node:fs/promises';
import type { LanguagePackFiles, LanguagePackPaths } from '../models/language-pack';
import type { SettingsStore } from '../settings/settings-store';
import type { LanguageSelection } from '../../shared/dictation-languages';
import { consoleLogger } from '../logging/logger';
import type { ActiveModel } from './active-model';
import { DirectGeneration } from './direct-generation';
import { localBackend, type LocalEngineArch } from './local-backend';
import { sameSpec, type GenerationSpec, type LocalGeneration } from './local-generation';
import { localLanguagePlan, needsLanguagePack, type LocalLanguagePlan } from './local-language';
import { LocalResidents } from './local-residents';
import { RoutedGeneration } from './routed-generation';
import { EngineUnavailableError, notReady, type EngineReadiness, type EngineUnavailableReason, type Preparation, type TranscriptionEngine } from './transcription-engine';

const VERIFICATION_REASON = { missing: 'model-missing', broken: 'model-broken' } as const;
export const LOCAL_CALL_TIMEOUT_MS = 60_000;

export type LocalEngineDeps = {
  binary: string;
  acceleratorBinary?: string;
  models: ActiveModel;
  languagePack?: LanguagePackFiles;
  settings: Pick<SettingsStore, 'get' | 'onChange'>;
  arch: LocalEngineArch;
  platform?: NodeJS.Platform;
  clock?: Clock;
  callTimeoutMs?: number;
  segment?: Partial<SegmentConfig>;
};

type Lease = { released: boolean; revision: number };

type LanguageTarget = { plan: LocalLanguagePlan; pack: LanguagePackPaths | null };

type Target = { ready: false; reason: EngineUnavailableReason } | { ready: true; spec: GenerationSpec };

const NO_LANGUAGE_PACK: LanguagePackFiles = Object.freeze({ paths: () => Promise.resolve(null) });

function generationSpec(model: string, { plan, pack }: LanguageTarget): GenerationSpec {
  if (plan.kind === 'routed' && pack !== null) {
    return { kind: 'routed', model, pack };
  }
  return { kind: 'direct', model };
}

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
  private generation: LocalGeneration | undefined;
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

  private acquire(spec: GenerationSpec): LocalGeneration {
    if (this.generation !== undefined) return this.generation;
    const generation = this.createGeneration(spec);
    this.anchor ??= this.clock.now();
    this.generation = generation;
    void generation.startup.catch((error: unknown) => {
      if (this.generation !== generation) return;
      this.clearIdle();
      this.generation = undefined;
      this.shutdown = Promise.all([this.shutdown, generation.close()]).then(() => undefined);
      void this.shutdown.catch((failure: unknown) => consoleLogger.error('Local worker shutdown failed', failure));
      consoleLogger.error('Local model could not start', error);
    });
    return generation;
  }

  private createGeneration(spec: GenerationSpec): LocalGeneration {
    const residents = new LocalResidents({ binary: this.deps.binary, ...(this.deps.acceleratorBinary === undefined ? {} : { acceleratorBinary: this.deps.acceleratorBinary }), callTimeoutMs: this.deps.callTimeoutMs ?? LOCAL_CALL_TIMEOUT_MS }, this.backend());
    if (spec.kind === 'routed') {
      return new RoutedGeneration(spec.model, spec.pack, residents, this.clock);
    }
    return new DirectGeneration(spec.model, residents, this.clock);
  }

  private isCurrent(lease: Lease): boolean {
    return !this.disposed && lease.revision === this.revision;
  }

  private async settle(spec: GenerationSpec, lease: Lease): Promise<LocalGeneration | null> {
    if (!this.isCurrent(lease)) return null;
    if (this.generation !== undefined && !sameSpec(this.generation.spec, spec)) await this.close();
    await this.shutdown;
    if (!this.isCurrent(lease)) return null;
    if (this.generation !== undefined && !sameSpec(this.generation.spec, spec)) return this.settle(spec, lease);
    return this.acquire(spec);
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
    const closing = generation?.close();
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
    const target = await this.target();
    if (!target.ready) return { ready: false, reason: target.reason };
    return { ready: true };
  }

  private async target(): Promise<Target> {
    if (!(await isExecutable(this.deps.binary))) return { ready: false, reason: 'binary-missing' };
    const model = await this.deps.models.activeModelPath();
    if (model === null) return { ready: false, reason: 'no-model' };
    const verification = await this.deps.models.verifyActive();
    if (verification !== 'ok') return { ready: false, reason: VERIFICATION_REASON[verification] };
    const language = await this.languageTarget(this.deps.settings.get().languages);
    if (language.plan.kind === 'unavailable') return { ready: false, reason: language.plan.reason };
    return { ready: true, spec: generationSpec(model, language) };
  }

  private async languageTarget(selection: LanguageSelection): Promise<LanguageTarget> {
    const hint = this.deps.models.activeLanguageHint();
    const pack = needsLanguagePack(selection, hint) ? await (this.deps.languagePack ?? NO_LANGUAGE_PACK).paths() : null;
    return { plan: localLanguagePlan(selection, hint, pack !== null), pack };
  }

  async prepare(): Promise<Preparation> {
    const lease = this.reserve();
    let transferred = false;
    try {
      const target = await this.target();
      if (!target.ready) return notReady(target.reason);
      const generation = await this.settle(target.spec, lease);
      if (generation === null) return notReady('no-model');
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
            const plan = localLanguagePlan(options.languages, this.deps.models.activeLanguageHint(), generation.spec.kind === 'routed');
            if (plan.kind === 'unavailable') {
              state = 'released';
              this.release(lease);
              throw new EngineUnavailableError(plan.reason);
            }
            state = 'started';
            const dictation = generation.dictation(plan, {
              clock: this.clock,
              options: { ...options, signal: AbortSignal.any([options.signal, generation.retired.signal]) },
              onRecordingEnd: () => {
                if (lease.revision !== this.revision) return;
                this.recordingEnded = true;
                this.anchor = Math.max(this.anchor ?? 0, this.clock.now());
              },
              onTerminal: () => this.release(lease),
              ...(this.deps.segment === undefined ? {} : { segment: this.deps.segment }),
            });
            if (dictation === null) {
              this.release(lease);
              throw new Error('Local preparation no longer matches the dictation languages');
            }
            return dictation;
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
      const spec = generationSpec(modelPath, await this.languageTarget(this.deps.settings.get().languages));
      const generation = await this.settle(spec, lease);
      if (generation === null) throw new Error('Warm-up selection changed');
      await generation.warmUp();
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
}
