import type { HotkeyBinding } from '../../shared/hotkey';

export function isReservedHotkey(binding: HotkeyBinding, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin' && binding.kind === 'key' && binding.keycode === 9 && binding.modifiers.includes('control') && binding.modifiers.includes('meta') && !binding.modifiers.includes('alt') && !binding.modifiers.includes('shift');
}
