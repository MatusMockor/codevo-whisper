import type { BrowserWindow } from 'electron';
import type { RendererSource } from './renderer-source';

export function loadSource(window: BrowserWindow, source: RendererSource): Promise<void> {
  if (source.kind === 'dev-server') {
    return window.loadURL(source.url);
  }
  return window.loadFile(source.path);
}
