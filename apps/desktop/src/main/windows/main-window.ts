import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { fileURLToPath } from 'node:url';
import type { PageId } from '../../shared/pages';
import { loadSource } from './load-source';
import { rendererSource } from './renderer-source';
import type { WindowPresentation } from './window-presentation';

const APP_TITLE = 'Codevo Whisper';

function windowChrome(): BrowserWindowConstructorOptions {
  if (process.platform !== 'darwin') {
    return {};
  }
  return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } };
}

export function createMainWindow(page: PageId, presentation: WindowPresentation): BrowserWindow {
  const window = new BrowserWindow({
    title: APP_TITLE,
    width: 980,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    show: false,
    ...windowChrome(),
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  window.once('ready-to-show', () => {
    presentation.show(window);
  });
  void loadSource(window, rendererSource(), page === 'home' ? '' : page);
  return window;
}
