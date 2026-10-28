export const HOTKEY_KEYCODES = [54, 58, 61, 62, 63] as const;

export type HotkeyKeycode = (typeof HOTKEY_KEYCODES)[number];

export type HotkeySetting = { keycode: HotkeyKeycode; label: string } | null;

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
