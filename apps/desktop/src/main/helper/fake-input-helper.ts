import type { HotkeyBinding, HotkeyEvent } from '../../shared/hotkey';
import type { HotkeyRecordResult } from '../../shared/hotkey-record';
import { consoleLogger } from '../logging/logger';
import type { AppTarget, FocusedElement, InputHelper, InputLostReason, ModifierFlags, PermissionKind, Permissions, ShortcutName } from './input-helper';
import { Listeners } from './listeners';

export type FakeInputHelperState = {
  frontmost: AppTarget | null;
  editable: boolean | null;
  role: string | null;
  secureInput: boolean;
  clipboard: string;
  clipboardWriteFails: boolean;
  modifiers: ModifierFlags;
  permissions: Permissions;
  recordedHotkey: HotkeyRecordResult;
};

const DEFAULT_STATE: FakeInputHelperState = {
  frontmost: { bundleId: 'com.apple.TextEdit', pid: 100, name: 'TextEdit', windowId: 1 },
  editable: true,
  role: 'AXTextArea',
  secureInput: false,
  clipboard: '',
  clipboardWriteFails: false,
  modifiers: { control: false, command: false, option: false, shift: false },
  permissions: { listen: true, post: true, accessibility: true },
  recordedHotkey: 'timeout',
};

export class FakeInputHelper implements InputHelper {
  frontmostApp: AppTarget | null;
  editable: boolean | null;
  role: string | null;
  secureInputEnabled: boolean;
  clipboard: string;
  clipboardWriteFails: boolean;
  modifiers: ModifierFlags;
  modifierQueries = 0;
  permissionState: Permissions;
  recordedHotkey: HotkeyRecordResult;
  running = false;
  listenFails = false;
  listening: HotkeyBinding | null = null;
  readonly pasted: string[] = [];
  readonly requestedPermissions: PermissionKind[] = [];
  readonly recordTimeouts: number[] = [];
  private savedClipboard: string | null = null;
  private readonly keys = new Listeners<HotkeyEvent>(consoleLogger, 'Fake key listener failed');
  private readonly shortcuts = new Listeners<ShortcutName>(consoleLogger, 'Fake shortcut listener failed');
  private readonly inputLosses = new Listeners<InputLostReason>(consoleLogger, 'Fake input lost listener failed');

  constructor(state: Partial<FakeInputHelperState> = {}) {
    const initial = { ...DEFAULT_STATE, ...state };
    this.frontmostApp = initial.frontmost;
    this.editable = initial.editable;
    this.role = initial.role;
    this.secureInputEnabled = initial.secureInput;
    this.clipboard = initial.clipboard;
    this.clipboardWriteFails = initial.clipboardWriteFails;
    this.modifiers = { ...initial.modifiers };
    this.permissionState = { ...initial.permissions };
    this.recordedHotkey = initial.recordedHotkey;
  }

  start(): Promise<void> {
    this.running = true;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.running = false;
    this.listening = null;
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

  modifierFlags(): Promise<ModifierFlags> {
    this.modifierQueries += 1;
    return Promise.resolve({ ...this.modifiers });
  }

  saveClipboard(): Promise<void> {
    this.savedClipboard = this.clipboard;
    return Promise.resolve();
  }

  writeClipboard(text: string): Promise<void> {
    if (this.clipboardWriteFails) {
      this.clipboard = '';
      return Promise.reject(new Error('clipboard-write-failed:set-string-failed'));
    }
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

  restoreSavedClipboard(): Promise<boolean> {
    const saved = this.savedClipboard;
    this.savedClipboard = null;
    if (saved === null) {
      return Promise.resolve(false);
    }
    this.clipboard = saved;
    return Promise.resolve(true);
  }

  paste(): Promise<void> {
    this.pasted.push(this.clipboard);
    return Promise.resolve();
  }

  listen(binding: HotkeyBinding | null, onReady?: () => void): Promise<void> {
    if (this.listenFails) {
      return Promise.reject(new Error('tap-create-failed'));
    }
    this.listening = binding;
    onReady?.();
    return Promise.resolve();
  }

  recordHotkey(timeoutMs: number): Promise<HotkeyRecordResult> {
    this.recordTimeouts.push(timeoutMs);
    return Promise.resolve(this.recordedHotkey);
  }

  onHotkey(listener: (event: HotkeyEvent) => void): () => void {
    return this.keys.add(listener);
  }

  onShortcut(listener: (name: ShortcutName) => void): () => void {
    return this.shortcuts.add(listener);
  }

  onInputLost(listener: (reason: InputLostReason) => void): () => void {
    return this.inputLosses.add(listener);
  }

  emitHotkey(phase: HotkeyEvent['phase'], ts = Date.now()): void {
    if (this.listening !== null) this.keys.emit({ phase, ts });
  }

  pressPasteLast(): void {
    this.shortcuts.emit('paste-last');
  }

  loseInput(reason: InputLostReason): void {
    this.inputLosses.emit(reason);
  }
}
