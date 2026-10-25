import { app, BrowserWindow, session } from 'electron';
import { installContentSecurityPolicy } from './security/content-security-policy';
import { hardenWebContents } from './security/harden';
import { createMainWindow } from './windows/main-window';
import { rendererSource } from './windows/renderer-source';

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

void app.whenReady().then(() => {
  if (rendererSource().kind === 'file') {
    installContentSecurityPolicy(session.defaultSession);
  }
  createMainWindow();
});
