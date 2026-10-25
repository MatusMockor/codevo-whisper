import type { BrowserWindow } from 'electron';
import type { RendererSource } from './renderer-source';

export function loadSource(window: BrowserWindow, source: RendererSource, hash = ''): Promise<void> {
  if (source.kind === 'dev-server') {
    return window.loadURL(hash === '' ? source.url : `${source.url}#${hash}`);
  }
  return window.loadFile(source.path, { hash });
}
