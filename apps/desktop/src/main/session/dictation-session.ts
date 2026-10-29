import type { AudioCapture } from '../audio/audio-capture';
import type { EngineSelector } from '../engines/engine-selector';
import type { DictationOptions, EngineDictation, Preparation, PreparedEngine, TranscriptUpdate } from '../engines/transcription-engine';
import { EngineUnavailableError, TranscriptionFailedError } from '../engines/transcription-engine';
import type { AppTarget, InputHelper } from '../helper/input-helper';
import type { StopReason } from '../hotkey/hotkey-service';
import type { InsertionOutcome, InsertionService } from '../insertion/insertion-service';
import type { LastTranscript } from '../insertion/last-transcript';
import type { SerialQueue } from '../insertion/serial-queue';
import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../settings/settings-store';
import type { LiveText, OverlayState } from '../../shared/overlay-contract';
import type { Language, MicrophoneSetting } from '../../shared/settings';
import type { RecordingAudioLease, RecordingAudioSettings } from '../../shared/recording-audio';
import { FrameRelay } from './frame-relay';
import { LiveTranscript } from './live-transcript';
import { errorState, failureState, insertionState, languageChip, MESSAGES, readinessError } from './overlay-messages';
import { processFinalTranscript, type TranscriptSettings } from './process-final-transcript';

export type SessionOverlay = {
  owns(session: DictationSession): boolean;
  show(session: DictationSession, state: OverlayState): void;
  flash(session: DictationSession, state: OverlayState): void;
  hide(session: DictationSession): void;
};

export type DictationSessionDeps = {
  capture: AudioCapture;
  engines: Pick<EngineSelector, 'prepare'>;
  insertion: Pick<InsertionService, 'insert'>;
  lastTranscript: LastTranscript;
  helper: Pick<InputHelper, 'frontmost' | 'focusedElement' | 'beginRecordingAudio'>;
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
type TerminalState = Extract<OverlayState, { kind: 'inserted' | 'copied' | 'blocked' | 'error' }>;
type ErrorState = Extract<TerminalState, { kind: 'error' }>;
type TransientState = Extract<OverlayState, { kind: 'recording' | 'processing' }>;
type TerminalIntent =
  | { kind: 'result'; state: TerminalState }
  | { kind: 'abandoned'; state: ErrorState }
  | { kind: 'cancelled' }
  | { kind: 'shutdown' };
type Presentation =
  | { kind: 'none' }
  | { kind: 'hide' }
  | { kind: 'show'; state: TransientState }
  | { kind: 'flash'; state: TerminalState };

type ProcessingNotice = Extract<OverlayState, { kind: 'processing' }>['notice'];

const TRANSCRIBED_REASONS: ReadonlySet<StopReason> = new Set(['released', 'toggled', 'max-duration']);

const NOT_READY: Preparation = { ready: false };

export class DictationSession {
  private phase: Phase = 'recording';
  private readonly startedAt: number;
  private readonly language: Language;
  private readonly transcriptSettings: TranscriptSettings;
  private readonly partials: boolean;
  private readonly live: LiveTranscript | null;
  private lastLevel = 0;
  private notice: ProcessingNotice;
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
  private readonly audioSettings: RecordingAudioSettings;
  private audio: RecordingAudioLease | null = null;
  private restoreError: ErrorState | null = null;
  private microphoneOpened = false;
  private closing: Promise<Uint8Array> | null = null;
  private intent: TerminalIntent | null = null;
  private cleanupDone = false;
  private flashed: TerminalState | null = null;

  constructor(private readonly deps: DictationSessionDeps) {
    this.startedAt = deps.clock();
    const { language, microphone, overlay, customWords, removeFillerWords, appendTrailingSpace } = deps.settings.get();
    this.language = language;
    this.transcriptSettings = Object.freeze({ language, customWords: Object.freeze([...customWords]), removeFillerWords, appendTrailingSpace });
    this.partials = overlay === 'live';
    this.live = this.partials ? new LiveTranscript() : null;
    this.microphone = microphone;
    const { muteWhileRecording, audioFeedback, feedbackOutputId, feedbackVolume } = deps.settings.get();
    this.audioSettings = { muteWhileRecording, audioFeedback, feedbackOutputId, feedbackVolume };
  }

  begin(): void {
    this.showRecording();
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
    this.lastLevel = Math.max(0, Math.min(1, rms));
    this.showRecording();
  }

  async finish(reason: StopReason): Promise<void> {
    if (this.phase !== 'recording') {
      await this.stopCapture();
      return;
    }
    if (!TRANSCRIBED_REASONS.has(reason)) {
      await this.chooseTerminal({ kind: 'cancelled' });
      return;
    }
    this.phase = 'finishing';
    this.notice = reason === 'max-duration' ? 'limit-reached' : undefined;
    this.showProcessing();
    const pcm = await this.stopCapture();
    if (!(await this.opened)) {
      await this.chooseTerminal({ kind: 'abandoned', state: errorState(MESSAGES.microphone) });
      return;
    }
    const readiness = await this.readiness;
    if (this.controller.signal.aborted) {
      return;
    }
    if (!readiness.ready) {
      await this.chooseTerminal({ kind: 'result', state: readinessError(readiness.reason) });
      return;
    }
    const dictation = this.startDictation(readiness.engine);
    const transcription = this.transcribe(dictation);
    await this.deps.pipeline.run(() => this.transcribeAndInsert(transcription, pcm));
  }

  cancel(): Promise<void> {
    return this.chooseTerminal({ kind: 'shutdown' });
  }

  private async openMicrophone(): Promise<boolean> {
    let acquiringAudio = true;
    try {
      const started = await this.deps.captureLane.run(async () => {
        if (this.phase !== 'recording') return null;
        this.audio = await this.deps.helper.beginRecordingAudio(this.audioSettings);
        acquiringAudio = false;
        if (this.phase !== 'recording') {
          await this.finishAudio(false);
          return null;
        }
        this.unsubscribeFrames = this.deps.capture.onFrame((pcm) => this.relay.push(pcm));
        try {
          const started = await this.deps.capture.start(this.microphone);
          this.microphoneOpened = true;
          return started;
        } catch (error) {
          this.unsubscribeFrames();
          await this.finishAudio(false);
          throw error;
        }
      });
      if (started === null) return false;
      this.noteFallback(started.fallback);
      return true;
    } catch (error) {
      this.deps.logger.error('The microphone could not be started', error);
      if (this.phase === 'recording') {
        await this.chooseTerminal({ kind: 'abandoned', state: errorState(acquiringAudio ? MESSAGES.recordingAudio : MESSAGES.microphone) });
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
      try {
        this.adopt(readiness.engine);
      } catch (error) {
        this.deps.logger.error('The prepared engine could not start', error);
        await this.chooseTerminal({ kind: 'abandoned', state: this.failure(error) });
      }
      return;
    }
    if (this.phase !== 'recording') {
      return;
    }
    await this.chooseTerminal({ kind: 'abandoned', state: readinessError(readiness.reason) });
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
    const dictation = engine.start(this.dictationOptions());
    this.dictation = dictation;
    this.relay.attach(dictation);
    return dictation;
  }

  private dictationOptions(): DictationOptions {
    const options: DictationOptions = { language: this.language, vocabulary: this.transcriptSettings.customWords, signal: this.controller.signal, partials: this.partials };
    if (this.live === null) {
      return options;
    }
    return { ...options, onTranscript: (update) => this.onTranscript(update) };
  }

  private onTranscript(update: TranscriptUpdate): void {
    if (this.live === null) {
      return;
    }
    this.live.apply(update);
    if (this.phase === 'recording') {
      this.showRecording();
      return;
    }
    if (this.phase === 'finishing') {
      this.showProcessing();
    }
  }

  private releaseEngine(): void {
    this.relay.drop();
    if (this.dictation !== null || this.prepared === null) {
      return;
    }
    this.prepared.release();
  }

  private chooseTerminal(next: TerminalIntent): Promise<void> {
    if (this.intent !== null && next.kind !== 'shutdown') {
      return this.stopCapture().then(() => undefined);
    }
    this.intent = next;
    this.phase = 'done';
    const closing = this.stopCapture();
    if (next.kind !== 'result') {
      this.controller.abort();
      this.releaseEngine();
    }
    this.present();
    if (next.kind === 'abandoned') this.deps.abandon(this);
    return closing.then(() => undefined);
  }

  private stopCapture(): Promise<Uint8Array> {
    return this.closing ??= this.deps.captureLane
      .run(async () => {
        let pcm: Uint8Array = new Uint8Array(0);
        try {
          if (this.microphoneOpened) pcm = await this.deps.capture.stop();
        } catch (error) {
          this.deps.logger.error('The recording could not be stopped', error);
        } finally {
          this.unsubscribeFrames();
          await this.finishAudio(this.microphoneOpened && this.intent?.kind !== 'shutdown');
        }
        this.cleanupDone = true;
        this.present();
        return pcm;
      });
  }

  private async finishAudio(playStop: boolean): Promise<void> {
    const audio = this.audio;
    this.audio = null;
    if (audio === null) return;
    await audio.finish({ playStop }).catch((error: unknown) => {
      this.deps.logger.error('The recording audio could not be restored', error);
      this.restoreError ??= errorState(MESSAGES.recordingAudio);
      this.present();
    });
  }

  private async transcribeAndInsert(transcription: Promise<string | null>, pcm: Uint8Array): Promise<void> {
    const rawText = await transcription;
    if (this.controller.signal.aborted) return;
    if (rawText === null) {
      return;
    }
    const text = this.finalize(rawText);
    if (text === '') {
      await this.chooseTerminal({ kind: 'result', state: errorState(MESSAGES.nothingHeard) });
      return;
    }
    this.deps.transcribed(text, pcm);
    const target = await this.target;
    const outcome = await this.insert(text, target);
    await this.chooseTerminal({ kind: 'result', state: insertionState(outcome, target?.name ?? '') });
  }

  private async transcribe(dictation: EngineDictation): Promise<string | null> {
    try {
      return await dictation.finish();
    } catch (error) {
      if (this.controller.signal.aborted) {
        return null;
      }
      this.deps.logger.error('The transcription failed', error);
      await this.chooseTerminal({ kind: 'result', state: this.failure(error) });
      return null;
    }
  }

  private failure(error: unknown): ErrorState {
    if (error instanceof EngineUnavailableError) {
      return readinessError(error.reason);
    }
    if (!(error instanceof TranscriptionFailedError)) {
      return errorState(MESSAGES.transcriptionFailed);
    }
    const textSoFar = this.finalize(error.textSoFar);
    return failureState(error.reason, textSoFar !== '');
  }

  private finalize(text: string): string {
    const processed = processFinalTranscript({ text, settings: this.transcriptSettings });
    if (processed !== '') this.deps.lastTranscript.set(processed, this.transcriptSettings);
    return processed;
  }

  private insert(text: string, target: AppTarget | null): Promise<InsertionOutcome | null> {
    if (this.controller.signal.aborted) {
      return Promise.resolve(null);
    }
    return this.deps.insertion.insert(text, target, this.transcriptSettings).catch((error: unknown) => {
      this.deps.logger.error('The transcript could not be inserted', error);
      return null;
    });
  }

  private decision(transient: TransientState | null): Presentation {
    const intent = this.intent;
    if (intent?.kind === 'shutdown') return { kind: 'none' };
    if (this.restoreError !== null) return { kind: 'flash', state: this.restoreError };
    if (intent?.kind === 'result' || intent?.kind === 'abandoned') {
      return { kind: 'flash', state: intent.state };
    }
    if (intent?.kind === 'cancelled') return { kind: this.cleanupDone ? 'hide' : 'none' };
    return transient === null ? { kind: 'none' } : { kind: 'show', state: transient };
  }

  private present(transient: TransientState | null = null): void {
    const decision = this.decision(transient);
    if (decision.kind === 'none' || !this.deps.overlay.owns(this)) return;
    if (decision.kind === 'flash') {
      if (this.flashed === decision.state) return;
      this.flashed = decision.state;
      this.deps.overlay.flash(this, decision.state);
      return;
    }
    if (decision.kind === 'hide') {
      this.deps.overlay.hide(this);
      return;
    }
    this.deps.overlay.show(this, decision.state);
  }

  private showRecording(): void {
    const state = { kind: 'recording', elapsedMs: this.deps.clock() - this.startedAt, level: this.lastLevel, language: languageChip(this.language) } as const;
    const withDevice = this.fallbackDevice === null ? state : { ...state, fallbackDevice: this.fallbackDevice };
    this.present(this.withLive(withDevice));
  }

  private showProcessing(): void {
    const state = this.notice === undefined ? ({ kind: 'processing' } as const) : ({ kind: 'processing', notice: this.notice } as const);
    this.present(this.withLive(state));
  }

  private withLive<T extends OverlayState>(state: T): T | (T & { live: LiveText }) {
    if (this.live === null) {
      return state;
    }
    return { ...state, live: this.live.view() };
  }
}
