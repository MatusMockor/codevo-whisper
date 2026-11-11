import { useEffect } from 'react';
import { isPaletteShortcut, paletteShortcutAria, paletteShortcutLabel } from './palette-shortcut';

const MAC = navigator.userAgent.includes('Mac');

export const PALETTE_KEYS = Object.freeze({ label: paletteShortcutLabel(MAC), aria: paletteShortcutAria(MAC) });

export function usePaletteShortcut(onToggle: () => void): void {
  useEffect(() => {
    const handle = (event: KeyboardEvent): void => {
      if (event.repeat || !isPaletteShortcut(event, MAC)) {
        return;
      }
      event.preventDefault();
      onToggle();
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onToggle]);
}
