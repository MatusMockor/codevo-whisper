import { app, session } from 'electron';
import { join } from 'node:path';
import { CaptureWindow } from '../audio/capture-window';
import { WindowAudioCapture } from '../audio/window-audio-capture';
import { Listeners } from '../helper/listeners';
import { electronPowerEvents } from '../hotkey/electron-power-events';
import { HotkeyService } from '../hotkey/hotkey-service';
import { InsertionService } from '../insertion/insertion-service';
import { LastTranscript } from '../insertion/last-transcript';
import { registerIpc } from '../ipc/register-ipc';
import { isTrustedSenderUrl } from '../ipc/trusted-sender';
import type { Logger } from '../logging/logger';
import { installContentSecurityPolicy } from '../security/content-security-policy';
import { installPermissionHandlers } from '../security/permissions';
import { PauseState } from '../session/pause-state';
import { SessionCoordinator } from '../session/session-coordinator';
import { SettingsStore } from '../settings/settings-store';
import { TrayMenu } from '../tray/tray-menu';
import { MainWindowController } from '../windows/main-window-controller';
import { OverlayWindow } from '../windows/overlay-window';
import { rendererSource } from '../windows/renderer-source';
import type { OverlayState } from '../../shared/overlay-contract';
import { exposeE2eHooks } from './e2e-hooks';
import { createHomeServices } from './home-wiring';
import { createInputHelper } from './input-helper-factory';
import { createModels } from './model-wiring';
import { startInput } from './start-input';

const SETTINGS_FILE = 'settings.json';

export type Application = {
  initialize(): Promise<void>;
  openMainWindow(): void;
  hasMainWindow(): boolean;
  dispose(): void;
};

function installSecurity(captureWindow: CaptureWindow): void {
  const source = rendererSource();
  installPermissionHandlers(session.defaultSession, {
    isCaptureFrame: (contents, url) => captureWindow.isCaptureFrame(contents, url),
    isAppFrame: (contents, url) => isTrustedSenderUrl(url, source) && !captureWindow.isCaptureFrame(contents, url),
  });
  if (source.kind !== 'file') {
    return;
  }
  installContentSecurityPolicy(session.defaultSession);
}

export function composeApplication(logger: Logger): Application {
  const helper = createInputHelper(logger);
  const captureWindow = new CaptureWindow(rendererSource('capture'), logger);
  const capture = new WindowAudioCapture(captureWindow, logger);
  const lastTranscript = new LastTranscript();
  const mainWindow = new MainWindowController(logger);
  const disposers: Array<() => void> = [];

  async function initialize(): Promise<void> {
    installSecurity(captureWindow);
    const settings = new SettingsStore(join(app.getPath('userData'), SETTINGS_FILE), logger);
    await settings.load();
    const models = createModels(settings, logger);
    const pause = new PauseState(logger);
    const input = Promise.withResolvers<void>();
    const home = createHomeServices({ settings, models: models.manager, helper, pause, inputReady: input.promise, window: mainWindow, logger });
    registerIpc({ settings, stats: home.stats, status: home.status, lastTranscript, source: rendererSource() });
    const hotkey = new HotkeyService(helper, settings, electronPowerEvents, undefined, logger);
    const insertion = new InsertionService(helper, settings, lastTranscript, undefined, logger);
    const overlay = new OverlayWindow(rendererSource('overlay'), logger);
    const views = new Listeners<OverlayState>(logger, 'An overlay view failed');
    views.add((state) => overlay.show(state));
    const coordinator = new SessionCoordinator({
      hotkey,
      capture,
      engine: models.engine,
      insertion,
      lastTranscript,
      helper,
      settings,
      stats: home.stats,
      pause,
      overlay: (state) => views.emit(state),
      openSettings: () => mainWindow.open('settings'),
      logger,
    });
    const tray = new TrayMenu({
      coordinator,
      capture,
      settings,
      lastTranscript,
      models: models.manager,
      openApp: () => mainWindow.open(),
      openSettings: () => mainWindow.open('settings'),
      quit: () => app.quit(),
      logger,
    });
    views.add((state) => tray.reflect(state));
    overlay.onAction((action) => coordinator.act(action));
    coordinator.start();
    tray.create();
    disposers.push(
      () => coordinator.dispose(),
      () => hotkey.dispose(),
      () => tray.destroy(),
      () => overlay.destroy(),
      () => home.dispose(),
    );
    exposeE2eHooks(!app.isPackaged && process.env['CW_E2E_HOOKS'] === '1', { capture, overlay, lastTranscript });
    void startInput(helper, hotkey, logger).then(() => {
      input.resolve();
      home.status.refresh();
    });
    models.checkInBackground();
  }

  return {
    initialize,
    openMainWindow: () => mainWindow.open(),
    hasMainWindow: () => mainWindow.isOpen(),
    dispose: () => {
      for (const dispose of disposers.splice(0)) {
        dispose();
      }
      void helper.stop();
    },
  };
}
