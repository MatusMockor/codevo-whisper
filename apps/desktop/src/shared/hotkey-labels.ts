import { HOTKEY_KEYCODES, type HotkeyKeycode } from './settings';

export const HOTKEY_LABELS: Readonly<Record<HotkeyKeycode, string>> = Object.freeze({
  54: 'Pravý ⌘ Command',
  58: 'Ľavý ⌥ Option',
  61: 'Pravý ⌥ Option',
  62: 'Pravý ⌃ Control',
  63: 'Fn / 🌐',
});

export function isHotkeyKeycode(keycode: number): keycode is HotkeyKeycode {
  return HOTKEY_KEYCODES.some((supported) => supported === keycode);
}
