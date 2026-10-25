import { app, dialog } from 'electron';
import { configureAppIdentity } from './app/app-identity';
import { composeApplication } from './app/compose';
import { createStartup } from './app/startup';
import { isE2eMode } from './app/test-mode';
import { consoleLogger } from './logging/logger';
import { hardenWebContents } from './security/harden';
import { runInBackground } from './windows/window-presentation';

configureAppIdentity();
app.enableSandbox();
if (isE2eMode()) {
  runInBackground();
}

const application = composeApplication(consoleLogger);

function failStartup(error: unknown): void {
  consoleLogger.error('Codevo Whisper failed to start', error);
  dialog.showErrorBox('Codevo Whisper sa nepodarilo spustiť', String(error));
  app.quit();
}

const startup = createStartup(app.whenReady(), {
  initialize: () => application.initialize(),
  openWindow: () => application.openMainWindow(),
  hasWindow: () => application.hasMainWindow(),
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

app.on('before-quit', (event) => {
  application.beforeQuit(event);
});

app.on('will-quit', () => {
  application.dispose();
});

app.on('activate', () => {
  void startup.activate();
});
