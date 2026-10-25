import { app, BrowserWindow, dialog, session } from 'electron';
import { join } from 'node:path';
import { configureAppIdentity } from './app/app-identity';
import { createStartup } from './app/startup';
import { registerIpc } from './ipc/register-ipc';
import { consoleLogger } from './logging/logger';
import { installContentSecurityPolicy } from './security/content-security-policy';
import { hardenWebContents } from './security/harden';
import { SettingsStore } from './settings/settings-store';
import { createMainWindow } from './windows/main-window';
import { rendererSource } from './windows/renderer-source';

const SETTINGS_FILE = 'settings.json';

configureAppIdentity();
app.enableSandbox();

async function initialize(): Promise<void> {
  const source = rendererSource();
  if (source.kind === 'file') {
    installContentSecurityPolicy(session.defaultSession);
  }
  const settings = new SettingsStore(join(app.getPath('userData'), SETTINGS_FILE), consoleLogger);
  await settings.load();
  registerIpc({ settings, source });
}

function failStartup(error: unknown): void {
  consoleLogger.error('Codevo Whisper failed to start', error);
  dialog.showErrorBox('Codevo Whisper sa nepodarilo spustiť', String(error));
  app.quit();
}

const startup = createStartup(app.whenReady(), {
  initialize,
  openWindow: () => {
    createMainWindow();
  },
  hasWindow: () => BrowserWindow.getAllWindows().length > 0,
  fail: failStartup,
});

app.on('web-contents-created', (_event, contents) => {
  hardenWebContents(contents);
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    return;
  }
  app.quit();
});

app.on('activate', () => {
  void startup.activate();
});
