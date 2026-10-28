import type { HotkeyBinding } from './hotkey';

export type HotkeySetting = (HotkeyBinding & { label: string }) | null;

export type DictationMode = 'hold' | 'toggle' | 'smart';

export type Language = 'sk' | 'en' | 'cs' | 'auto';

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

export type InsertionMode = 'paste' | 'clipboard';

export type LocalAcceleration = 'auto' | 'gpu' | 'cpu';

export type LocalModelUnload = 'never' | 'immediately' | 2 | 5 | 10 | 15 | 60;

export type OverlayMode = 'indicator' | 'live';

export type Settings = {
  customWords: readonly string[];
  removeFillerWords: boolean;
  appendTrailingSpace: boolean;
  hotkey: HotkeySetting;
  mode: DictationMode;
  language: Language;
  microphone: MicrophoneSetting;
  engineOrder: Array<EngineId>;
  localModelId: string | null;
  localAcceleration: LocalAcceleration;
  localModelUnload: LocalModelUnload;
  insertion: InsertionMode;
  overlay: OverlayMode;
  launchAtLogin: boolean;
  onboardingDone: boolean;
};

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  customWords: Object.freeze([]),
  removeFillerWords: false,
  appendTrailingSpace: false,
  hotkey: null,
  mode: 'smart',
  language: 'sk',
  microphone: Object.freeze({ deviceId: null, label: null }),
  engineOrder: Object.freeze(['local']) as Array<EngineId>,
  localModelId: null,
  localAcceleration: 'auto',
  localModelUnload: 5,
  insertion: 'paste',
  overlay: 'indicator',
  launchAtLogin: false,
  onboardingDone: false,
});

export function isCustomWords(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 100 && value.every((word: unknown) =>
    typeof word === 'string' && [...word].length <= 64 && new TextEncoder().encode(word).length <= 256 &&
    /^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’.-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*$/u.test(word));
}
