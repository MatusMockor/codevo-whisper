import type { AutoSubmit } from '../../shared/settings';
import type { OutputAudioView, RecordingAudioLease, RecordingAudioSettings } from '../../shared/recording-audio';
import type { HotkeyBinding, HotkeyEvent } from '../../shared/hotkey';
import type { HotkeyRecordResult } from '../../shared/hotkey-record';
import { consoleLogger, type Logger } from '../logging/logger';
import type { HelperChannel, HelperMessage } from './helper-channel';
import {
  failureReason,
  isTrue,
  parseFocusedElement,
  parseFrontmost,
  parseInputLost,
  parseHotkeyEvent,
  parseModifierFlags,
  parsePermissions,
  parseOutputAudio,
  parseRecordedHotkey,
  parseShortcut,
  requireBoolean,
} from './helper-responses';
import type { AppTarget, DeliveryDecision, DeliveryRequest, FocusedElement, InputHelper, InputLostReason, ModifierFlags, PermissionKind, Permissions, ShortcutName } from './input-helper';
import { Listeners } from './listeners';

const PERMISSION_REQUEST_TIMEOUT_MS = 60_000;
const FOCUSED_ELEMENT_TIMEOUT_MS = 3000;
const TYPING_TIMEOUT_MS = 120_000;

function ensure(message: HelperMessage, key: string, failure: string): void {
  if (isTrue(message, key)) {
    return;
  }
  throw new Error(`${failure}:${failureReason(message)}`);
}

export class HelperProcessInputHelper implements InputHelper {
  private operationId: string | null = null;
  private audioToken = 0;
  private pendingAudioToken: number | null = null;
  private desired: HotkeyBinding | null = null;
  private hasListened = false;
  private listenId = 0;
  private activeListenId: number | null = null;
  private registration: Promise<void> = Promise.resolve();
  private recordingId = 0;
  private cancelRecording: (() => void) | null = null;
  private pendingListen: { id: number; events: HotkeyEvent[] } | null = null;
  private readonly hotkeys: Listeners<HotkeyEvent>;

  constructor(
    private readonly channel: HelperChannel,
    private readonly logger: Logger = consoleLogger,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    this.hotkeys = new Listeners(logger, 'Hotkey listener failed');
    channel.onEvent((message) => {
      const event = parseHotkeyEvent(message);
      if (!event) return;
      if (this.activeListenId !== null && message['listenId'] === this.activeListenId) {
        this.hotkeys.emit(event);
        return;
      }
      if (this.pendingListen !== null && message['listenId'] === this.pendingListen.id) this.pendingListen.events.push(event);
    });
    channel.onRestart(() => {
      this.operationId = null;
      this.activeListenId = null;
      this.pendingListen = null;
      this.cancelRecording?.();
      void this.relisten();
    });
  }

  start(): Promise<void> {
    return this.channel.start();
  }

  async checkDelivery(request: DeliveryRequest): Promise<DeliveryDecision> {
    if (this.platform !== 'linux') return { kind: 'legacy' };
    this.operationId = null;
    const message = await this.channel.request('check-delivery', request, FOCUSED_ELEMENT_TIMEOUT_MS);
    const kind = message['kind'];
    const reason = message['reason'];
    if (kind === 'copy' && (reason === 'unverified-target' || reason === 'posting-unavailable' || reason === 'unsupported-output')) return { kind, reason };
    if (kind === 'blocked' && (reason === 'focus-changed' || reason === 'protected-input' || reason === 'modifiers-held')) return { kind, reason };
    if (kind === 'allowed') {
      const target = parseFrontmost(message);
      const operationId = message['operationId'];
      if (target !== null && target.windowId !== null && typeof operationId === 'string' && operationId.length > 0 && operationId.length <= 256) {
        this.operationId = operationId;
        return { kind, target };
      }
    }
    throw new Error('delivery-decision-invalid');
  }

  async getOutputAudio(): Promise<OutputAudioView> {
    if (this.platform !== 'darwin') return { kind: 'unavailable', reason: 'platform' };
    return parseOutputAudio(await this.channel.request('output-audio'));
  }

  async beginRecordingAudio(settings: RecordingAudioSettings): Promise<RecordingAudioLease> {
    if (this.pendingAudioToken !== null) await this.endRecordingAudio(this.pendingAudioToken, false);
    if (!settings.muteWhileRecording && !settings.audioFeedback) return { finish: () => Promise.resolve() };
    if (this.platform !== 'darwin') throw new Error('recording-audio-unavailable');
    const token = ++this.audioToken;
    try {
      ensure(await this.channel.request('recording-audio-begin', { token, mute: settings.muteWhileRecording, feedback: settings.audioFeedback, outputId: settings.feedbackOutputId ?? '', volume: settings.feedbackVolume }), 'begun', 'recording-audio-begin-failed');
    } catch (error) {
      await this.endRecordingAudio(token, false).catch((cleanup: unknown) => this.logger.error('Recording audio acquisition cleanup failed', cleanup));
      throw error;
    }
    let finishing: Promise<void> | undefined;
    return { finish: ({ playStop }) => finishing ??= this.endRecordingAudio(token, playStop) };
  }

  private async endRecordingAudio(token: number, playStop: boolean): Promise<void> {
    try {
      ensure(await this.channel.request('recording-audio-end', { token, playStop }), 'ended', 'recording-audio-end-failed');
      if (this.pendingAudioToken === token) this.pendingAudioToken = null;
    } catch (error) {
      this.pendingAudioToken = token;
      throw error;
    }
  }

  stop(): Promise<void> {
    this.hasListened = false;
    this.activeListenId = null;
    this.pendingListen = null;
    this.cancelRecording?.();
    return this.channel.stop();
  }

  async permissions(): Promise<Permissions> {
    return parsePermissions(await this.channel.request('permissions'));
  }

  async requestPermission(kind: PermissionKind): Promise<void> {
    await this.channel.request('request-permission', { kind }, PERMISSION_REQUEST_TIMEOUT_MS);
  }

  async frontmost(): Promise<AppTarget | null> {
    return parseFrontmost(await this.channel.request('frontmost'));
  }

  async secureInput(): Promise<boolean> {
    return requireBoolean(await this.channel.request('secure-input'), 'enabled', 'secure-input-invalid');
  }

  async focusedElement(): Promise<FocusedElement> {
    return parseFocusedElement(await this.channel.request('focused-element', {}, FOCUSED_ELEMENT_TIMEOUT_MS));
  }

  async modifierFlags(): Promise<ModifierFlags> {
    return parseModifierFlags(await this.channel.request('modifier-flags'));
  }

  async saveClipboard(): Promise<void> {
    await this.channel.request('clipboard-save');
  }

  async writeClipboard(text: string): Promise<void> {
    ensure(await this.channel.request('clipboard-write', { text }), 'written', 'clipboard-write-failed');
  }

  async restoreClipboard(expectedText: string): Promise<boolean> {
    return requireBoolean(await this.channel.request('clipboard-restore', { expectedText }), 'restored', 'clipboard-restore-invalid');
  }

  async restoreSavedClipboard(): Promise<boolean> {
    return requireBoolean(await this.channel.request('clipboard-restore', { force: true }), 'restored', 'clipboard-restore-invalid');
  }

  async paste(): Promise<void> {
    ensure(await this.channel.request('paste', this.platform === 'linux' ? { operationId: this.operationId } : {}), 'posted', 'paste-failed');
  }

  async typeText(text: string): Promise<void> {
    ensure(await this.channel.request('type-text', { text }, TYPING_TIMEOUT_MS), 'posted', 'type-failed');
  }

  async submit(mode: Exclude<AutoSubmit, 'off'>): Promise<void> {
    ensure(await this.channel.request('submit', { mode, ...(this.platform === 'linux' ? { operationId: this.operationId } : {}) }), 'posted', 'submit-failed');
  }

  listen(binding: HotkeyBinding | null, onReady?: () => void): Promise<void> {
    this.desired = binding;
    this.hasListened = true;
    this.activeListenId = null;
    const listenId = ++this.listenId;
    this.pendingListen = { id: listenId, events: [] };
    const pending = this.pendingListen;
    const configure = this.registration.then(async () => {
      if (listenId !== this.listenId || !this.hasListened) return;
      try {
        ensure(await this.channel.request('listen-start', { listenId, ...(binding ?? { kind: 'none' }) }), 'running', 'listen-failed');
        if (listenId !== this.listenId || !this.hasListened) return;
        this.activeListenId = listenId;
        this.pendingListen = null;
        onReady?.();
        for (const event of pending.events) {
          if (this.activeListenId !== listenId) break;
          this.hotkeys.emit(event);
        }
      } finally {
        if (this.pendingListen?.id === listenId) this.pendingListen = null;
      }
    });
    this.registration = configure.catch(() => undefined);
    return configure;
  }

  async recordHotkey(timeoutMs: number): Promise<HotkeyRecordResult> {
    if (this.cancelRecording !== null) throw new Error('recording-in-progress');
    const recordingId = ++this.recordingId;
    const recording = this.nextRecordedHotkey(recordingId, timeoutMs);
    try {
      ensure(await this.channel.request('record-key', { recordingId, timeoutMs }), 'recording', 'record-failed');
    } catch (error) {
      recording.cancel();
      throw error;
    }
    return recording.result;
  }

  onHotkey(listener: (event: HotkeyEvent) => void): () => void {
    return this.hotkeys.add(listener);
  }

  onShortcut(listener: (name: ShortcutName) => void): () => void {
    return this.channel.onEvent((message) => {
      const name = parseShortcut(message);
      if (!name) {
        return;
      }
      listener(name);
    });
  }

  onInputLost(listener: (reason: InputLostReason) => void): () => void {
    const unsubscribeEvents = this.channel.onEvent((message) => {
      const reason = parseInputLost(message);
      if (!reason) {
        return;
      }
      listener(reason);
    });
    const unsubscribeRestarts = this.channel.onRestart(() => listener('helper-restarted'));
    const unsubscribeGiveUps = this.channel.onGiveUp(() => listener('helper-died'));
    return () => {
      unsubscribeEvents();
      unsubscribeRestarts();
      unsubscribeGiveUps();
    };
  }

  private nextRecordedHotkey(recordingId: number, timeoutMs: number): { result: Promise<HotkeyRecordResult>; cancel: () => void } {
    let finish: (value: HotkeyRecordResult) => void = () => undefined;
    const result = new Promise<HotkeyRecordResult>((resolve) => {
      const timer = setTimeout(() => finish('timeout'), timeoutMs + 1000);
      const unsubscribe = this.channel.onEvent((message) => {
        if (message['recordingId'] !== recordingId) return;
        const recorded = parseRecordedHotkey(message);
        if (recorded !== null) finish(recorded);
      });
      const unsubscribeGiveUp = this.channel.onGiveUp(() => finish('timeout'));
      finish = (value) => {
        clearTimeout(timer);
        unsubscribe();
        unsubscribeGiveUp();
        this.cancelRecording = null;
        resolve(value);
      };
    });
    this.cancelRecording = () => finish('timeout');
    return { result, cancel: this.cancelRecording };
  }

  private async relisten(): Promise<void> {
    if (!this.hasListened) return;
    await this.listen(this.desired).catch((error: unknown) => {
      this.logger.error('Input helper could not listen again after a restart', error);
    });
  }
}
