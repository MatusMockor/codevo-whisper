import { consoleLogger, type Logger } from '../logging/logger';
import type { HelperChannel, HelperMessage } from './helper-channel';
import {
  failureReason,
  isTrue,
  parseFocusedElement,
  parseFrontmost,
  parseKeyEvent,
  parsePermissions,
  parseRecordedKey,
  parseShortcut,
  requireBoolean,
} from './helper-responses';
import type { AppTarget, FocusedElement, InputHelper, KeyEvent, PermissionKind, Permissions, ShortcutName } from './input-helper';

const PERMISSION_REQUEST_TIMEOUT_MS = 60_000;
const FOCUSED_ELEMENT_TIMEOUT_MS = 3000;

function ensure(message: HelperMessage, key: string, failure: string): void {
  if (isTrue(message, key)) {
    return;
  }
  throw new Error(`${failure}:${failureReason(message)}`);
}

export class HelperProcessInputHelper implements InputHelper {
  private keycodes: number[] | null = null;

  constructor(
    private readonly channel: HelperChannel,
    private readonly logger: Logger = consoleLogger,
  ) {
    channel.onRestart(() => {
      void this.relisten();
    });
  }

  start(): Promise<void> {
    return this.channel.start();
  }

  stop(): Promise<void> {
    this.keycodes = null;
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

  async saveClipboard(): Promise<void> {
    await this.channel.request('clipboard-save');
  }

  async writeClipboard(text: string): Promise<void> {
    ensure(await this.channel.request('clipboard-write', { text }), 'written', 'clipboard-write-failed');
  }

  async restoreClipboard(expectedText: string): Promise<boolean> {
    return requireBoolean(await this.channel.request('clipboard-restore', { expectedText }), 'restored', 'clipboard-restore-invalid');
  }

  async paste(): Promise<void> {
    ensure(await this.channel.request('paste'), 'posted', 'paste-failed');
  }

  async listen(keycodes: number[]): Promise<void> {
    ensure(await this.channel.request('listen-start', { keycodes }), 'running', 'listen-failed');
    this.keycodes = [...keycodes];
  }

  async recordKey(timeoutMs: number): Promise<number | null> {
    const recording = this.nextRecordedKey(timeoutMs);
    try {
      ensure(await this.channel.request('record-key', { timeoutMs }), 'recording', 'record-failed');
    } catch (error) {
      recording.cancel();
      throw error;
    }
    return recording.result;
  }

  onKey(listener: (event: KeyEvent) => void): () => void {
    return this.channel.onEvent((message) => {
      const event = parseKeyEvent(message);
      if (!event) {
        return;
      }
      listener(event);
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

  private nextRecordedKey(timeoutMs: number): { result: Promise<number | null>; cancel: () => void } {
    let finish: (keycode: number | null) => void = () => undefined;
    const result = new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => finish(null), timeoutMs);
      const unsubscribe = this.channel.onEvent((message) => {
        const keycode = parseRecordedKey(message);
        if (keycode === null) {
          return;
        }
        finish(keycode);
      });
      finish = (keycode) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(keycode);
      };
    });
    return { result, cancel: () => finish(null) };
  }

  private async relisten(): Promise<void> {
    if (!this.keycodes) {
      return;
    }
    await this.listen(this.keycodes).catch((error: unknown) => {
      this.logger.error('Input helper could not listen again after a restart', error);
    });
  }
}
