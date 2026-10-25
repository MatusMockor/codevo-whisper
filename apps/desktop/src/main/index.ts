import { app, BrowserWindow, session } from 'electron';
import { join } from 'node:path';
import { configureAppIdentity } from './app/app-identity';
import { registerIpc } from './ipc/register-ipc';
import { installContentSecurityPolicy } from './security/content-security-policy';
import { hardenWebContents } from './security/harden';
import { SettingsStore } from './settings/settings-store';
import { createMainWindow } from './windows/main-window';
import { rendererSource } from './windows/renderer-source';

const SETTINGS_FILE = 'settings.json';

configureAppIdentity();
app.enableSandbox();

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
  if (BrowserWindow.getAllWindows().length > 0) {
    return;
  }
  createMainWindow();
});

void app.whenReady().then(async () => {
  const source = rendererSource();
  if (source.kind === 'file') {
    installContentSecurityPolicy(session.defaultSession);
  }
  const settings = new SettingsStore(join(app.getPath('userData'), SETTINGS_FILE));
  await settings.load();
  registerIpc({ settings, source });
  createMainWindow();
});
