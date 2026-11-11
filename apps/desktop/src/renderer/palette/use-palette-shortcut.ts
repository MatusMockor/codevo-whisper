import { useEffect } from 'react';
import { HOTKEY_RECORDING } from '../components/activity-gate';
import { paletteShortcutAria, paletteShortcutLabel, togglesPalette } from './palette-shortcut';

const MAC = navigator.userAgent.includes('Mac');

export const PALETTE_KEYS = Object.freeze({ label: paletteShortcutLabel(MAC), aria: paletteShortcutAria(MAC) });

export function usePaletteShortcut(onToggle: () => void): void {
  useEffect(() => {
    const handle = (event: KeyboardEvent): void => {
      if (!togglesPalette(event, MAC, HOTKEY_RECORDING.active)) {
        return;
      }
      event.preventDefault();
      onToggle();
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onToggle]);
}
