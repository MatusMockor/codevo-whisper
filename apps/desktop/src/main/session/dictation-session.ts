import type { AudioCapture } from '../audio/audio-capture';
import type { EngineReadiness, TranscriptionEngine } from '../engines/transcription-engine';
import { EngineUnavailableError } from '../engines/transcription-engine';
import type { AppTarget, InputHelper } from '../helper/input-helper';
import type { StopReason } from '../hotkey/hotkey-service';
import type { InsertionOutcome, InsertionService } from '../insertion/insertion-service';
import type { LastTranscript } from '../insertion/last-transcript';
import type { SerialQueue } from '../insertion/serial-queue';
import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../settings/settings-store';
import type { OverlayState } from '../../shared/overlay-contract';
import type { Language, MicrophoneSetting } from '../../shared/settings';
import { errorState, insertionState, languageChip, MESSAGES, readinessError } from './overlay-messages';

export type SessionOverlay = {
  show(session: DictationSession, state: OverlayState): void;
  flash(session: DictationSession, state: OverlayState): void;
  hide(session: DictationSession): void;
};

export type DictationSessionDeps = {
  capture: AudioCapture;
  engine: TranscriptionEngine;
  insertion: Pick<InsertionService, 'insert'>;
  lastTranscript: LastTranscript;
  helper: Pick<InputHelper, 'frontmost' | 'focusedElement'>;
  settings: Pick<SettingsStore, 'get'>;
  overlay: SessionOverlay;
  captureLane: SerialQueue;
  pipeline: SerialQueue;
  clock: () => number;
  logger: Logger;
};

type Phase = 'recording' | 'finishing' | 'done';

const TRANSCRIBED_REASONS: ReadonlySet<StopReason> = new Set(['released', 'toggled', 'max-duration']);

const NOT_READY: EngineReadiness = { ready: false };

export class DictationSession {
  private phase: Phase = 'recording';
  private readonly startedAt: number;
  private readonly language: Language;
  private readonly microphone: MicrophoneSetting;
  private readonly controller = new AbortController();
  private fallbackDevice: string | null = null;
  private target: Promise<AppTarget | null> = Promise.resolve(null);
  private readiness: Promise<EngineReadiness> = Promise.resolve(NOT_READY);
  private opened: Promise<boolean> = Promise.resolve(false);

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
    this.readiness = this.deps.engine.isReady().catch((error: unknown) => {
      this.deps.logger.error('The engine readiness check failed', error);
      return NOT_READY;
    });
    this.opened = this.openMicrophone();
    void this.readiness.then((readiness) => this.abandonIfNotReady(readiness));
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
      await this.stopCapture();
      this.deps.overlay.hide(this);
      return;
    }
    this.phase = 'finishing';
    this.deps.overlay.show(this, reason === 'max-duration' ? { kind: 'processing', notice: 'limit-reached' } : { kind: 'processing' });
    const pcm = await this.stopCapture();
    if (!(await this.opened)) {
      this.end(errorState(MESSAGES.microphone));
      return;
    }
    const readiness = await this.readiness;
    if (!readiness.ready) {
      this.end(readinessError(readiness.reason));
      return;
    }
    await this.deps.pipeline.run(() => this.transcribeAndInsert(pcm));
  }

  cancel(): void {
    this.phase = 'done';
    this.controller.abort();
  }

  private async openMicrophone(): Promise<boolean> {
    try {
      const started = await this.deps.captureLane.run(() => this.deps.capture.start(this.microphone));
      this.noteFallback(started.fallback);
      return true;
    } catch (error) {
      this.deps.logger.error('The microphone could not be started', error);
      if (this.phase === 'recording') {
        this.end(errorState(MESSAGES.microphone));
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

  private async abandonIfNotReady(readiness: EngineReadiness): Promise<void> {
    if (readiness.ready || this.phase !== 'recording') {
      return;
    }
    this.end(readinessError(readiness.reason));
    await this.stopCapture();
  }

  private stopCapture(): Promise<Uint8Array> {
    return this.deps.captureLane
      .run(() => this.deps.capture.stop())
      .catch((error: unknown) => {
        this.deps.logger.error('The recording could not be stopped', error);
        return new Uint8Array(0);
      });
  }

  private async transcribeAndInsert(pcm: Uint8Array): Promise<void> {
    const text = await this.transcribe(pcm);
    if (text === null) {
      return;
    }
    if (text === '') {
      this.end(errorState(MESSAGES.nothingHeard));
      return;
    }
    this.deps.lastTranscript.set(text);
    const target = await this.target;
    const outcome = await this.insert(text, target);
    this.end(insertionState(outcome, target?.name ?? ''));
  }

  private async transcribe(pcm: Uint8Array): Promise<string | null> {
    try {
      return (await this.deps.engine.transcribe(pcm, this.language, this.controller.signal)).trim();
    } catch (error) {
      if (this.controller.signal.aborted) {
        return null;
      }
      this.deps.logger.error('The transcription failed', error);
      this.end(error instanceof EngineUnavailableError ? readinessError(error.reason) : errorState(MESSAGES.transcriptionFailed));
      return null;
    }
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
