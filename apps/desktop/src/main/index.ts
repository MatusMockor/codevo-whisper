import { app, BrowserWindow, dialog, session } from 'electron';
import { join } from 'node:path';
import { configureAppIdentity } from './app/app-identity';
import { exposeE2eHooks } from './app/e2e-hooks';
import { createInputHelper } from './app/input-helper-factory';
import { startInput } from './app/start-input';
import { createStartup } from './app/startup';
import { CaptureWindow } from './audio/capture-window';
import { WindowAudioCapture } from './audio/window-audio-capture';
import { electronPowerEvents } from './hotkey/electron-power-events';
import { HotkeyService } from './hotkey/hotkey-service';
import { InsertionService } from './insertion/insertion-service';
import { LastTranscript } from './insertion/last-transcript';
import { bindPasteLastShortcut } from './insertion/paste-last-shortcut';
import { registerIpc } from './ipc/register-ipc';
import { consoleLogger } from './logging/logger';
import { installContentSecurityPolicy } from './security/content-security-policy';
import { hardenWebContents } from './security/harden';
import { installPermissionHandlers } from './security/permissions';
import { SettingsStore } from './settings/settings-store';
import { createMainWindow } from './windows/main-window';
import { rendererSource } from './windows/renderer-source';

const SETTINGS_FILE = 'settings.json';

configureAppIdentity();
app.enableSandbox();

const inputHelper = createInputHelper(consoleLogger);
const captureWindow = new CaptureWindow(rendererSource('capture'), consoleLogger);
const capture = new WindowAudioCapture(captureWindow, consoleLogger);
const lastTranscript = new LastTranscript();

async function initialize(): Promise<void> {
  installPermissionHandlers(session.defaultSession, (contents, url) => captureWindow.isCaptureFrame(contents, url));
  const source = rendererSource();
  if (source.kind === 'file') {
    installContentSecurityPolicy(session.defaultSession);
  }
  const settings = new SettingsStore(join(app.getPath('userData'), SETTINGS_FILE), consoleLogger);
  await settings.load();
  registerIpc({ settings, source });
  exposeE2eHooks(!app.isPackaged && process.env['CW_E2E_HOOKS'] === '1', { capture });
  bindPasteLastShortcut(inputHelper, new InsertionService(inputHelper, settings, lastTranscript), consoleLogger);
  void startInput(inputHelper, new HotkeyService(inputHelper, settings, electronPowerEvents), consoleLogger);
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
  hasWindow: () => BrowserWindow.getAllWindows().some((window) => !captureWindow.owns(window)),
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

app.on('will-quit', () => {
  void inputHelper.stop();
});

app.on('activate', () => {
  void startup.activate();
});
