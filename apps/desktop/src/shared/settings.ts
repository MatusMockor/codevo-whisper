import type { AiProvider, CodexEffort } from './ai';
import type { CustomWord } from './custom-words';
import type { LanguageSelection } from './dictation-languages';
import type { HotkeyBinding } from './hotkey';
import { DEFAULT_SESSION_SHORTCUTS, type SessionShortcutSettings } from './session-shortcuts';

export type HotkeySetting = (HotkeyBinding & { label: string }) | null;

export type DictationMode = 'hold' | 'toggle' | 'smart';

export type MicrophoneSetting = { deviceId: string | null; label: string | null };

export type EngineId = 'local' | 'server';

export const ENGINE_ORDERS: ReadonlyArray<ReadonlyArray<EngineId>> = Object.freeze([
  Object.freeze(['local'] as const),
  Object.freeze(['server'] as const),
  Object.freeze(['server', 'local'] as const),
  Object.freeze(['local', 'server'] as const),
]);

export function isEngineOrder(value: unknown): value is Array<EngineId> {
  if (!Array.isArray(value)) {
    return false;
  }
  return ENGINE_ORDERS.some((order) => order.length === value.length && order.every((engine, index) => engine === value[index]));
}

export type InsertionMode = 'paste' | 'type' | 'clipboard';

export type ClipboardPolicy = 'restore' | 'leave';

export type AutoSubmit = 'off' | 'enter' | 'primary-enter';

export type LinuxPasteShortcut = 'ctrl-v' | 'ctrl-shift-v' | 'shift-insert';

export type LocalAcceleration = 'auto' | 'gpu' | 'cpu';

export type LocalModelUnload = 'never' | 'immediately' | 2 | 5 | 10 | 15 | 60;

export type OverlayMode = 'indicator' | 'live';

export type Settings = {
  muteWhileRecording: boolean;
  audioFeedback: boolean;
  feedbackOutputId: string | null;
  feedbackVolume: number;
  customWords: readonly CustomWord[];
  removeFillerWords: boolean;
  appendTrailingSpace: boolean;
  hotkey: HotkeySetting;
  sessionShortcuts: SessionShortcutSettings;
  mode: DictationMode;
  languages: LanguageSelection;
  microphones: readonly MicrophoneSetting[];
  engineOrder: Array<EngineId>;
  serverEnabled: boolean;
  serverRestoreOrder: Array<EngineId> | null;
  localModelId: string | null;
  localAcceleration: LocalAcceleration;
  localModelUnload: LocalModelUnload;
  insertion: InsertionMode;
  clipboardPolicy: ClipboardPolicy;
  autoSubmit: AutoSubmit;
  linuxPasteShortcut: LinuxPasteShortcut;
  overlay: OverlayMode;
  launchAtLogin: boolean;
  onboardingDone: boolean;
  aiBaseUrl: string | null;
  aiModel: string;
  aiPolish: boolean;
  aiInstructions: string;
  aiProvider: AiProvider;
  codexModel: string;
  codexEffort: CodexEffort;
};

export const MAX_AI_INSTRUCTIONS = 1000;

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  muteWhileRecording: false,
  audioFeedback: false,
  feedbackOutputId: null,
  feedbackVolume: 50,
  customWords: Object.freeze([]),
  removeFillerWords: false,
  appendTrailingSpace: false,
  hotkey: null,
  sessionShortcuts: DEFAULT_SESSION_SHORTCUTS,
  mode: 'smart',
  languages: Object.freeze({ mode: 'auto', selected: Object.freeze(['sk'] as const) }),
  microphones: Object.freeze([]),
  engineOrder: Object.freeze(['local']) as Array<EngineId>,
  serverEnabled: true,
  serverRestoreOrder: null,
  localModelId: null,
  localAcceleration: 'auto',
  localModelUnload: 5,
  insertion: 'paste',
  clipboardPolicy: 'restore',
  autoSubmit: 'off',
  linuxPasteShortcut: 'ctrl-v',
  overlay: 'indicator',
  launchAtLogin: false,
  onboardingDone: false,
  aiBaseUrl: null,
  aiModel: '',
  aiPolish: false,
  aiInstructions: '',
  aiProvider: 'server',
  codexModel: 'gpt-6-luna',
  codexEffort: 'low',
});
