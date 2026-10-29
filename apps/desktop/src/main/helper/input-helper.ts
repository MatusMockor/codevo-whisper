import type { AutoSubmit, LinuxPasteShortcut } from '../../shared/settings';
import type { OutputAudioView, RecordingAudioLease, RecordingAudioSettings } from '../../shared/recording-audio';
import type { HotkeyBinding, HotkeyEvent } from '../../shared/hotkey';
import type { HotkeyRecordResult } from '../../shared/hotkey-record';

export type AppTarget = { bundleId: string; pid: number; name: string; windowId: number | null };

export type Permissions = { listen: boolean; post: boolean; accessibility: boolean };

export type PermissionKind = 'listen' | 'accessibility';

export type FocusedElement = { editable: boolean | null; role: string | null };

export type ModifierFlags = { control: boolean; command: boolean; option: boolean; shift: boolean };

export type ShortcutName = 'paste-last';

export type InputLostReason = 'tap-reenabled' | 'tap-error' | 'helper-restarted' | 'helper-died';

export type DeliveryRequest = { expected: AppTarget | null; intent: 'automatic' | 'replay'; shortcut: LinuxPasteShortcut };
export type DeliveryDecision =
  | { kind: 'legacy' }
  | { kind: 'allowed'; target: AppTarget }
  | { kind: 'copy'; reason: 'unverified-target' | 'posting-unavailable' | 'unsupported-output' }
  | { kind: 'blocked'; reason: 'focus-changed' | 'protected-input' | 'modifiers-held' };

export interface InputHelper {
  checkDelivery(request: DeliveryRequest): Promise<DeliveryDecision>;
  getOutputAudio(): Promise<OutputAudioView>;
  beginRecordingAudio(settings: RecordingAudioSettings): Promise<RecordingAudioLease>;
  start(): Promise<void>;
  stop(): Promise<void>;
  permissions(): Promise<Permissions>;
  requestPermission(kind: PermissionKind): Promise<void>;
  frontmost(): Promise<AppTarget | null>;
  secureInput(): Promise<boolean>;
  focusedElement(): Promise<FocusedElement>;
  modifierFlags(): Promise<ModifierFlags>;
  saveClipboard(): Promise<void>;
  writeClipboard(text: string): Promise<void>;
  restoreClipboard(expectedText: string): Promise<boolean>;
  restoreSavedClipboard(): Promise<boolean>;
  paste(): Promise<void>;
  typeText(text: string): Promise<void>;
  submit(mode: Exclude<AutoSubmit, 'off'>): Promise<void>;
  listen(binding: HotkeyBinding | null, onReady?: () => void): Promise<void>;
  recordHotkey(timeoutMs: number): Promise<HotkeyRecordResult>;
  onHotkey(listener: (event: HotkeyEvent) => void): () => void;
  onShortcut(listener: (name: ShortcutName) => void): () => void;
  onInputLost(listener: (reason: InputLostReason) => void): () => void;
}
