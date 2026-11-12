import type { AiProvider, CodexEffort } from './ai';
import type { LanguageSelection } from './dictation-languages';
import type { HotkeyBinding } from './hotkey';

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
  customWords: readonly string[];
  removeFillerWords: boolean;
  appendTrailingSpace: boolean;
  hotkey: HotkeySetting;
  mode: DictationMode;
  languages: LanguageSelection;
  microphone: MicrophoneSetting;
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
  aiProvider: AiProvider;
  codexModel: string;
  codexEffort: CodexEffort;
};

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  muteWhileRecording: false,
  audioFeedback: false,
  feedbackOutputId: null,
  feedbackVolume: 50,
  customWords: Object.freeze([]),
  removeFillerWords: false,
  appendTrailingSpace: false,
  hotkey: null,
  mode: 'smart',
  languages: Object.freeze({ mode: 'auto', selected: Object.freeze(['sk'] as const) }),
  microphone: Object.freeze({ deviceId: null, label: null }),
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
  aiProvider: 'server',
  codexModel: 'gpt-6-luna',
  codexEffort: 'low',
});

export function isCustomWords(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 100 && value.every((word: unknown) =>
    typeof word === 'string' && [...word].length <= 64 && new TextEncoder().encode(word).length <= 256 &&
    /^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’.-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*$/u.test(word));
}
