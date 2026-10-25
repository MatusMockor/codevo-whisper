import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { fileURLToPath } from 'node:url';
import { rendererSource } from './renderer-source';

const APP_TITLE = 'Codevo Whisper';

function windowChrome(): BrowserWindowConstructorOptions {
  if (process.platform !== 'darwin') {
    return {};
  }
  return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } };
}

function loadRenderer(window: BrowserWindow): Promise<void> {
  const source = rendererSource();
  if (source.kind === 'dev-server') {
    return window.loadURL(source.url);
  }
  return window.loadFile(source.path);
}

export function createMainWindow(): BrowserWindow {
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
    window.show();
  });
  void loadRenderer(window);
  return window;
}
