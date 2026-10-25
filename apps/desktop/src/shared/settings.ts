export const HOTKEY_KEYCODES = [54, 58, 61, 62, 63] as const;

export type HotkeyKeycode = (typeof HOTKEY_KEYCODES)[number];

export type HotkeySetting = { keycode: HotkeyKeycode; label: string } | null;

export type DictationMode = 'hold' | 'toggle';

export type Language = 'sk' | 'en' | 'cs' | 'auto';

export type MicrophoneSetting = { deviceId: string | null; label: string | null };

export type EngineId = 'local' | 'server';

export type InsertionMode = 'paste' | 'clipboard';

export type OverlayMode = 'indicator' | 'live';

export type Settings = {
  hotkey: HotkeySetting;
  mode: DictationMode;
  language: Language;
  microphone: MicrophoneSetting;
  engineOrder: Array<EngineId>;
  localModelId: string | null;
  insertion: InsertionMode;
  overlay: OverlayMode;
  launchAtLogin: boolean;
  onboardingDone: boolean;
};

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  hotkey: null,
  mode: 'hold',
  language: 'sk',
  microphone: Object.freeze({ deviceId: null, label: null }),
  engineOrder: Object.freeze(['local']) as Array<EngineId>,
  localModelId: null,
  insertion: 'paste',
  overlay: 'indicator',
  launchAtLogin: false,
  onboardingDone: false,
});
