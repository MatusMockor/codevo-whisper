export type ShortcutKeys = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean };

export type ShortcutEvent = ShortcutKeys & { repeat: boolean; defaultPrevented: boolean; isComposing: boolean };

export function isPaletteShortcut(event: ShortcutKeys, mac: boolean): boolean {
  if (event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') {
    return false;
  }
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

export function togglesPalette(event: ShortcutEvent, mac: boolean, suspended: boolean): boolean {
  if (suspended || event.defaultPrevented || event.repeat || event.isComposing) {
    return false;
  }
  return isPaletteShortcut(event, mac);
}

export function paletteShortcutLabel(mac: boolean): string {
  return mac ? '⌘K' : 'Ctrl+K';
}

export function paletteShortcutAria(mac: boolean): string {
  return mac ? 'Meta+K' : 'Control+K';
}
