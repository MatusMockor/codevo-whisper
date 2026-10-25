import { consoleLogger } from '../logging/logger';
import type { AppTarget, FocusedElement, InputHelper, InputLostReason, KeyEvent, KeyPhase, PermissionKind, Permissions, ShortcutName } from './input-helper';
import { Listeners } from './listeners';

export type FakeInputHelperState = {
  frontmost: AppTarget | null;
  editable: boolean | null;
  role: string | null;
  secureInput: boolean;
  clipboard: string;
  permissions: Permissions;
  recordedKey: number | null;
};

const DEFAULT_STATE: FakeInputHelperState = {
  frontmost: { bundleId: 'com.apple.TextEdit', pid: 100, name: 'TextEdit', windowId: 1 },
  editable: true,
  role: 'AXTextArea',
  secureInput: false,
  clipboard: '',
  permissions: { listen: true, post: true, accessibility: true },
  recordedKey: null,
};

export class FakeInputHelper implements InputHelper {
  frontmostApp: AppTarget | null;
  editable: boolean | null;
  role: string | null;
  secureInputEnabled: boolean;
  clipboard: string;
  permissionState: Permissions;
  recordedKey: number | null;
  running = false;
  listening: number[] = [];
  readonly pasted: string[] = [];
  readonly requestedPermissions: PermissionKind[] = [];
  readonly recordTimeouts: number[] = [];
  private savedClipboard: string | null = null;
  private readonly keys = new Listeners<KeyEvent>(consoleLogger, 'Fake key listener failed');
  private readonly shortcuts = new Listeners<ShortcutName>(consoleLogger, 'Fake shortcut listener failed');
  private readonly inputLosses = new Listeners<InputLostReason>(consoleLogger, 'Fake input lost listener failed');

  constructor(state: Partial<FakeInputHelperState> = {}) {
    const initial = { ...DEFAULT_STATE, ...state };
    this.frontmostApp = initial.frontmost;
    this.editable = initial.editable;
    this.role = initial.role;
    this.secureInputEnabled = initial.secureInput;
    this.clipboard = initial.clipboard;
    this.permissionState = { ...initial.permissions };
    this.recordedKey = initial.recordedKey;
  }

  start(): Promise<void> {
    this.running = true;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.running = false;
    this.listening = [];
    return Promise.resolve();
  }

  permissions(): Promise<Permissions> {
    return Promise.resolve({ ...this.permissionState });
  }

  requestPermission(kind: PermissionKind): Promise<void> {
    this.requestedPermissions.push(kind);
    return Promise.resolve();
  }

  frontmost(): Promise<AppTarget | null> {
    return Promise.resolve(this.frontmostApp && { ...this.frontmostApp });
  }

  secureInput(): Promise<boolean> {
    return Promise.resolve(this.secureInputEnabled);
  }

  focusedElement(): Promise<FocusedElement> {
    return Promise.resolve({ editable: this.editable, role: this.role });
  }

  saveClipboard(): Promise<void> {
    this.savedClipboard = this.clipboard;
    return Promise.resolve();
  }

  writeClipboard(text: string): Promise<void> {
    this.clipboard = text;
    return Promise.resolve();
  }

  restoreClipboard(expectedText: string): Promise<boolean> {
    const saved = this.savedClipboard;
    this.savedClipboard = null;
    if (saved === null || this.clipboard !== expectedText) {
      return Promise.resolve(false);
    }
    this.clipboard = saved;
    return Promise.resolve(true);
  }

  paste(): Promise<void> {
    this.pasted.push(this.clipboard);
    return Promise.resolve();
  }

  listen(keycodes: number[]): Promise<void> {
    this.listening = [...keycodes];
    return Promise.resolve();
  }

  recordKey(timeoutMs: number): Promise<number | null> {
    this.recordTimeouts.push(timeoutMs);
    return Promise.resolve(this.recordedKey);
  }

  onKey(listener: (event: KeyEvent) => void): () => void {
    return this.keys.add(listener);
  }

  onShortcut(listener: (name: ShortcutName) => void): () => void {
    return this.shortcuts.add(listener);
  }

  onInputLost(listener: (reason: InputLostReason) => void): () => void {
    return this.inputLosses.add(listener);
  }

  pressKey(phase: KeyPhase, keycode: number, ts = Date.now()): void {
    if (!this.listening.includes(keycode)) {
      return;
    }
    this.keys.emit({ phase, keycode, ts });
  }

  pressPasteLast(): void {
    this.shortcuts.emit('paste-last');
  }

  loseInput(reason: InputLostReason): void {
    this.inputLosses.emit(reason);
  }
}
