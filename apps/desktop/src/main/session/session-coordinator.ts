import type { AudioCapture } from '../audio/audio-capture';
import type { TranscriptionEngine } from '../engines/transcription-engine';
import type { InputHelper } from '../helper/input-helper';
import type { HotkeyService, StopReason } from '../hotkey/hotkey-service';
import type { CopyLastOutcome, InsertionService, PasteLastOutcome } from '../insertion/insertion-service';
import type { LastTranscript } from '../insertion/last-transcript';
import { bindPasteLastShortcut } from '../insertion/paste-last-shortcut';
import { SerialQueue } from '../insertion/serial-queue';
import { consoleLogger, type Logger } from '../logging/logger';
import type { SettingsStore } from '../settings/settings-store';
import { countWords } from '../stats/count-words';
import type { StatsRecorder } from '../stats/stats-store';
import { pcmDurationMs } from '../../shared/pcm';
import type { OverlayAction, OverlayState } from '../../shared/overlay-contract';
import { DictationSession, type DictationSessionDeps, type SessionOverlay } from './dictation-session';
import { copyLastState, errorState, MESSAGES, pasteLastState } from './overlay-messages';
import { OverlayPresenter } from './overlay-presenter';
import type { PauseState } from './pause-state';

export type SessionCoordinatorDeps = {
  hotkey: HotkeyService;
  capture: AudioCapture;
  engine: TranscriptionEngine;
  insertion: InsertionService;
  lastTranscript: LastTranscript;
  helper: InputHelper;
  settings: SettingsStore;
  stats: StatsRecorder;
  pause: PauseState;
  overlay: (state: OverlayState) => void;
  openSettings?: () => void;
  clock?: () => number;
  logger?: Logger;
};

export class SessionCoordinator {
  private readonly presenter: OverlayPresenter;
  private readonly logger: Logger;
  private readonly sessions = new Set<DictationSession>();
  private readonly captureLane = new SerialQueue();
  private readonly pipeline = new SerialQueue();
  private recording: DictationSession | null = null;
  private unsubscribers: Array<() => void> = [];

  constructor(private readonly deps: SessionCoordinatorDeps) {
    this.presenter = new OverlayPresenter(deps.overlay);
    this.logger = deps.logger ?? consoleLogger;
  }

  start(): void {
    const { hotkey, capture, helper } = this.deps;
    this.unsubscribers = [
      hotkey.onStart(() => this.handleStart()),
      hotkey.onStop((reason) => this.handleStop(reason)),
      capture.onLevel((rms) => this.recording?.level(rms)),
      capture.onLimitReached(() => this.handleLimit()),
      bindPasteLastShortcut(helper, this, this.logger),
    ];
  }

  pause(): void {
    this.deps.pause.set(true);
    this.deps.hotkey.pause();
  }

  resume(): void {
    this.deps.pause.set(false);
    this.deps.hotkey.resume();
  }

  isPaused(): boolean {
    return this.deps.pause.isPaused();
  }

  async pasteLast(): Promise<PasteLastOutcome> {
    try {
      const outcome = await this.deps.insertion.pasteLast();
      this.showUtility(pasteLastState(outcome, await this.frontmostName()));
      return outcome;
    } catch (error) {
      this.showUtility(errorState(MESSAGES.insertFailed));
      throw error;
    }
  }

  async copyLast(): Promise<CopyLastOutcome> {
    try {
      const outcome = await this.deps.insertion.copyLast();
      this.showUtility(copyLastState(outcome));
      return outcome;
    } catch (error) {
      this.showUtility(errorState(MESSAGES.clipboardFailed));
      throw error;
    }
  }

  act(action: OverlayAction): void {
    if (action === 'open-settings') {
      this.deps.openSettings?.();
      return;
    }
    this.copyLast().catch((error: unknown) => {
      this.logger.error('Copying the last transcript failed', error);
    });
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
    for (const session of this.sessions) {
      session.cancel();
    }
    this.recording = null;
    this.presenter.dispose();
  }

  private handleStart(): void {
    const session = new DictationSession(this.sessionDeps());
    this.recording = session;
    this.sessions.add(session);
    this.presenter.claim(session);
    session.begin();
  }

  private handleStop(reason: StopReason): void {
    const session = this.recording;
    if (session === null) {
      return;
    }
    this.recording = null;
    session
      .finish(reason)
      .catch((error: unknown) => {
        this.logger.error('The dictation session failed', error);
      })
      .finally(() => {
        this.sessions.delete(session);
      });
  }

  private handleAbandon(session: DictationSession): void {
    if (this.recording !== session) {
      return;
    }
    this.deps.hotkey.cancel();
  }

  private handleLimit(): void {
    if (this.recording === null) {
      return;
    }
    this.deps.hotkey.stopForLimit();
  }

  private recordStats(text: string, pcm: Uint8Array): void {
    const words = countWords(text);
    if (words === 0) {
      return;
    }
    this.deps.stats.record({ words, seconds: pcmDurationMs(pcm) / 1000 }).catch((error: unknown) => {
      this.logger.error('The dictation statistics could not be saved', error);
    });
  }

  private showUtility(state: OverlayState): void {
    if (this.recording !== null) {
      return;
    }
    const owner = {};
    this.presenter.claim(owner);
    this.presenter.flash(owner, state);
  }

  private async frontmostName(): Promise<string> {
    const target = await this.deps.helper.frontmost().catch(() => null);
    return target?.name ?? '';
  }

  private sessionDeps(): DictationSessionDeps {
    return {
      capture: this.deps.capture,
      engine: this.deps.engine,
      insertion: this.deps.insertion,
      lastTranscript: this.deps.lastTranscript,
      helper: this.deps.helper,
      settings: this.deps.settings,
      overlay: this.sessionOverlay(),
      abandon: (session) => this.handleAbandon(session),
      transcribed: (text, pcm) => this.recordStats(text, pcm),
      captureLane: this.captureLane,
      pipeline: this.pipeline,
      clock: this.deps.clock ?? Date.now,
      logger: this.logger,
    };
  }

  private sessionOverlay(): SessionOverlay {
    return {
      show: (session, state) => this.presenter.show(session, state),
      flash: (session, state) => this.presenter.flash(session, state),
      hide: (session) => this.presenter.hide(session),
    };
  }
}
