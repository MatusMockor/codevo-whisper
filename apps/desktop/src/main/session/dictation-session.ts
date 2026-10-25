import type { AudioCapture } from '../audio/audio-capture';
import type { EngineSelector } from '../engines/engine-selector';
import type { EngineDictation, Preparation, PreparedEngine } from '../engines/transcription-engine';
import { EngineUnavailableError, TranscriptionFailedError } from '../engines/transcription-engine';
import type { AppTarget, InputHelper } from '../helper/input-helper';
import type { StopReason } from '../hotkey/hotkey-service';
import type { InsertionOutcome, InsertionService } from '../insertion/insertion-service';
import type { LastTranscript } from '../insertion/last-transcript';
import type { SerialQueue } from '../insertion/serial-queue';
import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../settings/settings-store';
import type { OverlayState } from '../../shared/overlay-contract';
import type { Language, MicrophoneSetting } from '../../shared/settings';
import { FrameRelay } from './frame-relay';
import { errorState, failureState, insertionState, languageChip, MESSAGES, readinessError } from './overlay-messages';

export type SessionOverlay = {
  show(session: DictationSession, state: OverlayState): void;
  flash(session: DictationSession, state: OverlayState): void;
  hide(session: DictationSession): void;
};

export type DictationSessionDeps = {
  capture: AudioCapture;
  engines: Pick<EngineSelector, 'prepare'>;
  insertion: Pick<InsertionService, 'insert'>;
  lastTranscript: LastTranscript;
  helper: Pick<InputHelper, 'frontmost' | 'focusedElement'>;
  settings: Pick<SettingsStore, 'get'>;
  overlay: SessionOverlay;
  abandon(session: DictationSession): void;
  transcribed(text: string, pcm: Uint8Array): void;
  captureLane: SerialQueue;
  pipeline: SerialQueue;
  clock: () => number;
  logger: Logger;
};

type Phase = 'recording' | 'finishing' | 'done';

const TRANSCRIBED_REASONS: ReadonlySet<StopReason> = new Set(['released', 'toggled', 'max-duration']);

const NOT_READY: Preparation = { ready: false };

export class DictationSession {
  private phase: Phase = 'recording';
  private readonly startedAt: number;
  private readonly language: Language;
  private readonly microphone: MicrophoneSetting;
  private readonly controller = new AbortController();
  private fallbackDevice: string | null = null;
  private target: Promise<AppTarget | null> = Promise.resolve(null);
  private readiness: Promise<Preparation> = Promise.resolve(NOT_READY);
  private opened: Promise<boolean> = Promise.resolve(false);
  private readonly relay = new FrameRelay();
  private dictation: EngineDictation | null = null;
  private prepared: PreparedEngine | null = null;
  private unsubscribeFrames: () => void = () => undefined;

  constructor(private readonly deps: DictationSessionDeps) {
    this.startedAt = deps.clock();
    const { language, microphone } = deps.settings.get();
    this.language = language;
    this.microphone = microphone;
  }

  begin(): void {
    this.showRecording(0);
    this.target = this.deps.helper.frontmost().catch((error: unknown) => {
      this.deps.logger.error('The insertion target could not be read', error);
      return null;
    });
    void this.target.then(() => this.deps.helper.focusedElement()).catch(() => undefined);
    this.readiness = this.deps.engines.prepare(this.deps.settings.get().engineOrder).catch((error: unknown) => {
      this.deps.logger.error('The engine readiness check failed', error);
      return NOT_READY;
    });
    this.opened = this.openMicrophone();
    void this.readiness.then((readiness) => this.onPrepared(readiness));
  }

  level(rms: number): void {
    if (this.phase !== 'recording') {
      return;
    }
    this.showRecording(Math.max(0, Math.min(1, rms)));
  }

  async finish(reason: StopReason): Promise<void> {
    if (this.phase !== 'recording') {
      return;
    }
    if (!TRANSCRIBED_REASONS.has(reason)) {
      this.phase = 'done';
      this.controller.abort();
      this.releaseEngine();
      await this.stopCapture();
      this.deps.overlay.hide(this);
      return;
    }
    this.phase = 'finishing';
    this.deps.overlay.show(this, reason === 'max-duration' ? { kind: 'processing', notice: 'limit-reached' } : { kind: 'processing' });
    const pcm = await this.stopCapture();
    if (!(await this.opened)) {
      this.end(errorState(MESSAGES.microphone));
      this.controller.abort();
      this.releaseEngine();
      return;
    }
    const readiness = await this.readiness;
    if (!readiness.ready) {
      this.end(readinessError(readiness.reason));
      return;
    }
    const dictation = this.startDictation(readiness.engine);
    await this.deps.pipeline.run(() => this.transcribeAndInsert(dictation, pcm));
  }

  cancel(): void {
    const recording = this.phase === 'recording';
    this.phase = 'done';
    this.controller.abort();
    this.releaseEngine();
    if (!recording) {
      return;
    }
    void this.stopCapture();
  }

  private async openMicrophone(): Promise<boolean> {
    try {
      const started = await this.deps.captureLane.run(async () => {
        this.unsubscribeFrames = this.deps.capture.onFrame((pcm) => this.relay.push(pcm));
        try {
          return await this.deps.capture.start(this.microphone);
        } catch (error) {
          this.unsubscribeFrames();
          throw error;
        }
      });
      this.noteFallback(started.fallback);
      return true;
    } catch (error) {
      this.deps.logger.error('The microphone could not be started', error);
      if (this.phase === 'recording') {
        this.abandon(errorState(MESSAGES.microphone));
      }
      return false;
    }
  }

  private noteFallback(fallback: boolean): void {
    if (!fallback) {
      return;
    }
    this.fallbackDevice = this.microphone.label ?? '';
    this.level(0);
  }

  private async onPrepared(readiness: Preparation): Promise<void> {
    if (readiness.ready) {
      this.adopt(readiness.engine);
      return;
    }
    if (this.phase !== 'recording') {
      return;
    }
    this.abandon(readinessError(readiness.reason));
    await this.stopCapture();
  }

  private adopt(engine: PreparedEngine): void {
    if (this.controller.signal.aborted || this.phase === 'done') {
      engine.release();
      return;
    }
    this.startDictation(engine);
  }

  private startDictation(engine: PreparedEngine): EngineDictation {
    if (this.dictation !== null) {
      return this.dictation;
    }
    this.prepared = engine;
    const dictation = engine.start({ language: this.language, signal: this.controller.signal });
    this.dictation = dictation;
    this.relay.attach(dictation);
    return dictation;
  }

  private releaseEngine(): void {
    this.relay.drop();
    if (this.dictation !== null || this.prepared === null) {
      return;
    }
    this.prepared.release();
  }

  private abandon(state: OverlayState): void {
    this.end(state);
    this.controller.abort();
    this.releaseEngine();
    this.deps.abandon(this);
  }

  private stopCapture(): Promise<Uint8Array> {
    return this.deps.captureLane
      .run(async () => {
        try {
          return await this.deps.capture.stop();
        } finally {
          this.unsubscribeFrames();
        }
      })
      .catch((error: unknown) => {
        this.deps.logger.error('The recording could not be stopped', error);
        return new Uint8Array(0);
      });
  }

  private async transcribeAndInsert(dictation: EngineDictation, pcm: Uint8Array): Promise<void> {
    const text = await this.transcribe(dictation);
    if (text === null) {
      return;
    }
    if (text === '') {
      this.end(errorState(MESSAGES.nothingHeard));
      return;
    }
    this.deps.lastTranscript.set(text);
    this.deps.transcribed(text, pcm);
    const target = await this.target;
    const outcome = await this.insert(text, target);
    this.end(insertionState(outcome, target?.name ?? ''));
  }

  private async transcribe(dictation: EngineDictation): Promise<string | null> {
    try {
      return (await dictation.finish()).trim();
    } catch (error) {
      if (this.controller.signal.aborted) {
        return null;
      }
      this.deps.logger.error('The transcription failed', error);
      this.end(this.failure(error));
      return null;
    }
  }

  private failure(error: unknown): OverlayState {
    if (error instanceof EngineUnavailableError) {
      return readinessError(error.reason);
    }
    if (!(error instanceof TranscriptionFailedError)) {
      return errorState(MESSAGES.transcriptionFailed);
    }
    const textSoFar = error.textSoFar.trim();
    if (textSoFar !== '') {
      this.deps.lastTranscript.set(textSoFar);
    }
    return failureState(error.reason, textSoFar !== '');
  }

  private insert(text: string, target: AppTarget | null): Promise<InsertionOutcome | null> {
    if (this.controller.signal.aborted) {
      return Promise.resolve(null);
    }
    return this.deps.insertion.insert(text, target).catch((error: unknown) => {
      this.deps.logger.error('The transcript could not be inserted', error);
      return null;
    });
  }

  private end(state: OverlayState): void {
    this.phase = 'done';
    if (this.controller.signal.aborted) {
      return;
    }
    this.deps.overlay.flash(this, state);
  }

  private showRecording(level: number): void {
    const state = { kind: 'recording', elapsedMs: this.deps.clock() - this.startedAt, level, language: languageChip(this.language) } as const;
    this.deps.overlay.show(this, this.fallbackDevice === null ? state : { ...state, fallbackDevice: this.fallbackDevice });
  }
}
