import type { AutoSubmit } from '../../shared/settings';
import type { OutputAudioView, RecordingAudioLease, RecordingAudioSettings } from '../../shared/recording-audio';
import type { HotkeyBinding, HotkeyEvent } from '../../shared/hotkey';
import type { HotkeyRecordResult } from '../../shared/hotkey-record';
import { consoleLogger } from '../logging/logger';
import { LockedTargetLostError, type AppTarget, type DeliveryDecision, type DeliveryRequest, type FieldContext, type FocusedElement, type InputHelper, type InputLostReason, type ModifierFlags, type PermissionKind, type Permissions, type RefocusResult, type ShortcutName, type TargetCapture } from './input-helper';
import { Listeners } from './listeners';
import type { OverlayAction } from '../../shared/overlay-contract';
import type { SessionShortcut } from '../session/session-shortcuts';

export type PostingStep = { cmd: 'clipboard-write' | 'paste' | 'type-text' | 'submit'; captureId: string | undefined };

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
  checkDelivery(_request: DeliveryRequest): Promise<DeliveryDecision> {
    return Promise.resolve({ kind: 'legacy' });
  }
  outputAudio: OutputAudioView = { kind: 'available', canMute: true, outputs: [{ id: 'speakers', label: 'Reproduktory' }, { id: 'headphones', label: 'Slúchadlá' }] };
  outputMuted = false;
  sessionShortcuts: readonly SessionShortcut[] = [];
  readonly audioTrace: string[] = [];
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
  readonly typed: string[] = [];
  readonly submitted: Exclude<AutoSubmit, 'off'>[] = [];
  readonly requestedPermissions: PermissionKind[] = [];
  readonly recordTimeouts: number[] = [];
  iconPath: string | null = null;
  refocusResult: RefocusResult = 'in-place';
  returnResult = true;
  readonly refocused: string[] = [];
  readonly returned: string[] = [];
  readonly released: string[] = [];
  fieldContext: FieldContext | null = null;
  readonly contextReads: string[] = [];
  readonly posting: PostingStep[] = [];
  capturedFocused = true;
  private captureCount = 0;
  private readonly captures = new Map<string, AppTarget>();
  private returnTo: AppTarget | null = null;
  holdRecordings = false;
  private releaseRecording: (() => void) | null = null;
  private savedClipboard: string | null = null;
  private readonly keys = new Listeners<HotkeyEvent>(consoleLogger, 'Fake key listener failed');
  private readonly shortcuts = new Listeners<ShortcutName>(consoleLogger, 'Fake shortcut listener failed');
  private readonly sessionKeys = new Listeners<OverlayAction>(consoleLogger, 'Fake session shortcut listener failed');
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

  getOutputAudio(): Promise<OutputAudioView> {
    return Promise.resolve(this.outputAudio);
  }

  beginRecordingAudio(settings: RecordingAudioSettings): Promise<RecordingAudioLease> {
    if (!settings.muteWhileRecording && !settings.audioFeedback) return Promise.resolve({ finish: () => Promise.resolve() });
    const original = this.outputMuted;
    if (settings.audioFeedback) this.audioTrace.push(`start:${settings.feedbackOutputId ?? 'default'}:${settings.feedbackVolume}`);
    if (settings.muteWhileRecording) {
      this.outputMuted = true;
      this.audioTrace.push('mute');
    }
    let finished = false;
    return Promise.resolve({ finish: ({ playStop }) => {
      if (finished) return Promise.resolve();
      finished = true;
      if (settings.muteWhileRecording) {
        this.outputMuted = original;
        this.audioTrace.push(`restore:${original}`);
      }
      if (settings.audioFeedback && playStop) this.audioTrace.push(`stop:${settings.feedbackOutputId ?? 'default'}:${settings.feedbackVolume}`);
      return Promise.resolve();
    } });
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

  restoreFrontmostFocus(): Promise<boolean> {
    return Promise.resolve(true);
  }

  captureTarget(): Promise<TargetCapture | null> {
    if (this.frontmostApp === null) return Promise.resolve(null);
    const captureId = `capture-${++this.captureCount}`;
    this.captures.set(captureId, { ...this.frontmostApp });
    return Promise.resolve({ captureId, target: { ...this.frontmostApp }, iconPath: this.iconPath });
  }

  refocusTarget(captureId: string): Promise<RefocusResult> {
    this.refocused.push(captureId);
    const captured = this.captures.get(captureId);
    if (captured === undefined) return Promise.resolve('failed');
    if (this.refocusResult !== 'failed') {
      this.returnTo = this.frontmostApp;
      this.frontmostApp = { ...captured };
    }
    return Promise.resolve(this.refocusResult);
  }

  returnFocus(captureId: string): Promise<boolean> {
    this.returned.push(captureId);
    if (this.returnResult && this.returnTo !== null) this.frontmostApp = this.returnTo;
    this.returnTo = null;
    return Promise.resolve(this.returnResult);
  }

  releaseTarget(captureId: string): Promise<void> {
    this.released.push(captureId);
    this.captures.delete(captureId);
    return Promise.resolve();
  }

  targetContext(captureId: string): Promise<FieldContext | null> {
    this.contextReads.push(captureId);
    return Promise.resolve(this.captures.has(captureId) ? this.fieldContext && { ...this.fieldContext } : null);
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

  writeClipboard(text: string, captureId?: string): Promise<void> {
    if (!this.guard('clipboard-write', captureId)) return Promise.reject(new LockedTargetLostError());
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

  paste(captureId?: string): Promise<void> {
    if (!this.guard('paste', captureId)) return Promise.reject(new LockedTargetLostError());
    this.pasted.push(this.clipboard);
    return Promise.resolve();
  }

  typeText(text: string, captureId?: string): Promise<void> {
    if (!this.guard('type-text', captureId)) return Promise.reject(new LockedTargetLostError());
    this.typed.push(text);
    return Promise.resolve();
  }

  submit(mode: Exclude<AutoSubmit, 'off'>, captureId?: string): Promise<void> {
    if (!this.guard('submit', captureId)) return Promise.reject(new LockedTargetLostError());
    this.submitted.push(mode);
    return Promise.resolve();
  }

  private guard(cmd: PostingStep['cmd'], captureId: string | undefined): boolean {
    this.posting.push({ cmd, captureId });
    return captureId === undefined || (this.capturedFocused && this.captures.has(captureId));
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
    if (!this.holdRecordings) return Promise.resolve(this.recordedHotkey);
    return new Promise((resolve) => {
      this.releaseRecording = () => resolve(this.recordedHotkey);
    });
  }

  finishRecording(): void {
    this.releaseRecording?.();
    this.releaseRecording = null;
  }

  onHotkey(listener: (event: HotkeyEvent) => void): () => void {
    return this.keys.add(listener);
  }

  onShortcut(listener: (name: ShortcutName) => void): () => void {
    return this.shortcuts.add(listener);
  }

  armSessionShortcuts(shortcuts: readonly SessionShortcut[]): Promise<void> {
    this.sessionShortcuts = shortcuts;
    return Promise.resolve();
  }

  onSessionShortcut(listener: (action: OverlayAction) => void): () => void {
    return this.sessionKeys.add(listener);
  }

  pressSessionShortcut(action: OverlayAction): void {
    if (this.sessionShortcuts.some((shortcut) => shortcut.action === action)) this.sessionKeys.emit(action);
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
