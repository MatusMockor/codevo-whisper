export type AppTarget = { bundleId: string; pid: number; name: string; windowId: number | null };

export type Permissions = { listen: boolean; post: boolean; accessibility: boolean };

export type PermissionKind = 'listen' | 'accessibility';

export type KeyPhase = 'down' | 'up';

export type KeyEvent = { phase: KeyPhase; keycode: number; ts: number };

export type FocusedElement = { editable: boolean | null; role: string | null };

export type ModifierFlags = { control: boolean; command: boolean; option: boolean; shift: boolean };

export type ShortcutName = 'paste-last';

export type InputLostReason = 'tap-reenabled' | 'tap-error' | 'helper-restarted';

export interface InputHelper {
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
  listen(keycodes: number[]): Promise<void>;
  recordKey(timeoutMs: number): Promise<number | null>;
  onKey(listener: (event: KeyEvent) => void): () => void;
  onShortcut(listener: (name: ShortcutName) => void): () => void;
  onInputLost(listener: (reason: InputLostReason) => void): () => void;
}
