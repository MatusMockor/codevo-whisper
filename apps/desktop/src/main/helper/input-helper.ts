import type { AutoSubmit, LinuxPasteShortcut } from '../../shared/settings';
import type { OutputAudioView, RecordingAudioLease, RecordingAudioSettings } from '../../shared/recording-audio';
import type { HotkeyBinding, HotkeyEvent } from '../../shared/hotkey';
import type { HotkeyRecordResult } from '../../shared/hotkey-record';
import type { OverlayAction } from '../../shared/overlay-contract';
import type { SessionShortcut } from '../session/session-shortcuts';

export type AppTarget = { bundleId: string; pid: number; name: string; windowId: number | null };

export type Permissions = { listen: boolean; post: boolean; accessibility: boolean };

export type PermissionKind = 'listen' | 'accessibility';

export type FocusedElement = { editable: boolean | null; role: string | null };

export type ModifierFlags = { control: boolean; command: boolean; option: boolean; shift: boolean };

export type ShortcutName = 'paste-last';

export type InputLostReason = 'tap-reenabled' | 'tap-error' | 'helper-restarted' | 'helper-died';

export type TargetCapture = { captureId: string; target: AppTarget; iconPath: string | null };

export type FieldContext = { before: string; after: string };

export type RefocusResult = 'in-place' | 'moved' | 'failed';

export type DeliveryRequest = { expected: AppTarget | null; intent: 'automatic' | 'replay'; shortcut: LinuxPasteShortcut; captureId?: string };
export type DeliveryDecision =
  | { kind: 'legacy' }
  | { kind: 'allowed'; target: AppTarget }
  | { kind: 'copy'; reason: 'unverified-target' | 'posting-unavailable' | 'unsupported-output' }
  | { kind: 'blocked'; reason: 'focus-changed' | 'protected-input' | 'modifiers-held' };

export type ClipboardPurpose = { kind: 'copy' } | { kind: 'paste'; policy: 'restore' | 'leave' };

export class LockedTargetLostError extends Error {
  constructor() {
    super('locked-target-lost');
    this.name = 'LockedTargetLostError';
  }
}

export interface InputHelper {
  checkDelivery(request: DeliveryRequest): Promise<DeliveryDecision>;
  getOutputAudio(): Promise<OutputAudioView>;
  beginRecordingAudio(settings: RecordingAudioSettings): Promise<RecordingAudioLease>;
  start(): Promise<void>;
  stop(): Promise<void>;
  permissions(): Promise<Permissions>;
  requestPermission(kind: PermissionKind): Promise<void>;
  frontmost(): Promise<AppTarget | null>;
  restoreFrontmostFocus(): Promise<boolean>;
  captureTarget(): Promise<TargetCapture | null>;
  refocusTarget(captureId: string): Promise<RefocusResult>;
  returnFocus(captureId: string): Promise<boolean>;
  releaseTarget(captureId: string): Promise<void>;
  targetContext(captureId: string): Promise<FieldContext | null>;
  secureInput(): Promise<boolean>;
  focusedElement(): Promise<FocusedElement>;
  modifierFlags(): Promise<ModifierFlags>;
  saveClipboard(purpose?: ClipboardPurpose): Promise<void>;
  writeClipboard(text: string, captureId?: string): Promise<void>;
  restoreClipboard(expectedText: string): Promise<boolean>;
  restoreSavedClipboard(): Promise<boolean>;
  paste(captureId?: string): Promise<void>;
  typeText(text: string, captureId?: string): Promise<void>;
  submit(mode: Exclude<AutoSubmit, 'off'>, captureId?: string): Promise<void>;
  listen(binding: HotkeyBinding | null, onReady?: () => void): Promise<void>;
  recordHotkey(timeoutMs: number): Promise<HotkeyRecordResult>;
  onHotkey(listener: (event: HotkeyEvent) => void): () => void;
  onShortcut(listener: (name: ShortcutName) => void): () => void;
  armSessionShortcuts(shortcuts: readonly SessionShortcut[]): Promise<void>;
  onSessionShortcut(listener: (action: OverlayAction) => void): () => void;
  onInputLost(listener: (reason: InputLostReason) => void): () => void;
}
