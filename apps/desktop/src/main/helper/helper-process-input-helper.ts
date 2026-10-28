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
  parseRecordedHotkey,
  parseShortcut,
  requireBoolean,
} from './helper-responses';
import type { AppTarget, FocusedElement, InputHelper, InputLostReason, ModifierFlags, PermissionKind, Permissions, ShortcutName } from './input-helper';

const PERMISSION_REQUEST_TIMEOUT_MS = 60_000;
const FOCUSED_ELEMENT_TIMEOUT_MS = 3000;

function ensure(message: HelperMessage, key: string, failure: string): void {
  if (isTrue(message, key)) {
    return;
  }
  throw new Error(`${failure}:${failureReason(message)}`);
}

export class HelperProcessInputHelper implements InputHelper {
  private desired: HotkeyBinding | null = null;
  private hasListened = false;
  private listenId = 0;
  private activeListenId: number | null = null;
  private registration: Promise<void> = Promise.resolve();
  private recordingId = 0;
  private cancelRecording: (() => void) | null = null;

  constructor(
    private readonly channel: HelperChannel,
    private readonly logger: Logger = consoleLogger,
  ) {
    channel.onRestart(() => {
      this.activeListenId = null;
      this.cancelRecording?.();
      void this.relisten();
    });
  }

  start(): Promise<void> {
    return this.channel.start();
  }

  stop(): Promise<void> {
    this.hasListened = false;
    this.activeListenId = null;
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
    ensure(await this.channel.request('paste'), 'posted', 'paste-failed');
  }

  listen(binding: HotkeyBinding | null): Promise<void> {
    this.desired = binding;
    this.hasListened = true;
    this.activeListenId = null;
    const listenId = ++this.listenId;
    const configure = this.registration.then(async () => {
      if (listenId !== this.listenId || !this.hasListened) return;
      ensure(await this.channel.request('listen-start', { listenId, ...(binding ?? { kind: 'none' }) }), 'running', 'listen-failed');
      if (listenId === this.listenId && this.hasListened) this.activeListenId = listenId;
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
    return this.channel.onEvent((message) => {
      if (this.activeListenId === null || message['listenId'] !== this.activeListenId) return;
      const event = parseHotkeyEvent(message);
      if (event) listener(event);
    });
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
