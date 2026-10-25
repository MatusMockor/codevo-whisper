import { app, powerMonitor, session, shell } from 'electron';
import { join } from 'node:path';
import { CaptureWindow } from '../audio/capture-window';
import { WindowAudioCapture } from '../audio/window-audio-capture';
import type { InputHelper } from '../helper/input-helper';
import { Listeners } from '../helper/listeners';
import { electronPowerEvents } from '../hotkey/electron-power-events';
import { HotkeyService } from '../hotkey/hotkey-service';
import { KeyRecorder } from '../hotkey/key-recorder';
import { HotkeyRearm } from '../hotkey/rearm-on-grant';
import { InsertionService } from '../insertion/insertion-service';
import { LastTranscript } from '../insertion/last-transcript';
import { registerIpc } from '../ipc/register-ipc';
import type { Logger } from '../logging/logger';
import { electronMicrophoneAccess } from '../permissions/electron-microphone-access';
import { MACOS_PERMISSION_LINKS } from '../permissions/macos-permission-links';
import { PermissionsService } from '../permissions/permissions-service';
import { appFrameCheck } from '../security/app-frame';
import { installContentSecurityPolicy } from '../security/content-security-policy';
import { installPermissionHandlers } from '../security/permissions';
import { PauseState } from '../session/pause-state';
import { SessionCoordinator } from '../session/session-coordinator';
import { SettingsStore } from '../settings/settings-store';
import { coordinatorDictationGuard } from '../updates/coordinator-dictation-guard';
import { TrayMenu } from '../tray/tray-menu';
import { MainWindowController } from '../windows/main-window-controller';
import { OverlayWindow } from '../windows/overlay-window';
import { rendererSource } from '../windows/renderer-source';
import { backgroundPresentation, foregroundPresentation } from '../windows/window-presentation';
import type { OverlayState } from '../../shared/overlay-contract';
import { exposeE2eHooks } from './e2e-hooks';
import { createHomeServices } from './home-wiring';
import { createInputHelper } from './input-helper-factory';
import { createModels } from './model-wiring';
import { createSettingsServices } from './settings-wiring';
import { QuitGate, type QuitEvent } from './quit-gate';
import { startInput } from './start-input';
import { isE2eMode } from './test-mode';
import { createUpdates, loadAutoUpdater } from './update-wiring';

const SETTINGS_FILE = 'settings.json';

export type Application = {
  initialize(): Promise<void>;
  openMainWindow(): void;
  hasMainWindow(): boolean;
  beforeQuit(event: QuitEvent): void;
  dispose(): void;
};

function installSecurity(captureWindow: CaptureWindow, mainWindow: MainWindowController): void {
  const source = rendererSource();
  installPermissionHandlers(session.defaultSession, {
    isCaptureFrame: (contents, url) => captureWindow.isCaptureFrame(contents, url),
    isAppFrame: appFrameCheck(source, (contents) => mainWindow.ownsContents(contents)),
  });
  if (source.kind !== 'file') {
    return;
  }
  installContentSecurityPolicy(session.defaultSession);
}

export function composeApplication(logger: Logger): Application {
  const e2e = isE2eMode();
  let startedHelper: InputHelper | null = null;
  const captureWindow = new CaptureWindow(rendererSource('capture'), logger);
  const capture = new WindowAudioCapture(captureWindow, logger);
  const lastTranscript = new LastTranscript(logger);
  const mainWindow = new MainWindowController(logger, e2e ? backgroundPresentation : foregroundPresentation);
  const disposers: Array<() => void> = [];
  const quitGate = new QuitGate(capture, () => app.quit(), logger);
  const allowShutdown = (): void => quitGate.systemShuttingDown();

  function disposeAll(): void {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
  }

  async function relaunch(): Promise<void> {
    disposeAll();
    await startedHelper?.stop().catch((error: unknown) => {
      logger.error('The input helper could not be stopped before the relaunch', error);
    });
    app.relaunch();
    app.exit(0);
  }

  async function initialize(): Promise<void> {
    installSecurity(captureWindow, mainWindow);
    const helper = await createInputHelper(logger, e2e && process.env['CW_E2E_FAKE_HELPER'] === '1');
    startedHelper = helper;
    powerMonitor.on('shutdown', allowShutdown);
    disposers.push(() => powerMonitor.removeListener('shutdown', allowShutdown));
    const settings = new SettingsStore(join(app.getPath('userData'), SETTINGS_FILE), logger);
    await settings.load();
    const models = createModels(settings, logger);
    const pause = new PauseState(logger);
    const input = Promise.withResolvers<void>();
    const permissions = new PermissionsService({
      helper,
      microphone: electronMicrophoneAccess,
      links: MACOS_PERMISSION_LINKS,
      openUrl: (url) => shell.openExternal(url),
      logger,
      inputReady: input.promise,
    });
    const home = createHomeServices({ settings, models: models.manager, permissions, pause, lastTranscript, window: mainWindow, logger });
    const settingsServices = createSettingsServices({ capture, models: models.manager, settings, window: mainWindow, isPackaged: app.isPackaged, logger });
    const hotkey = new HotkeyService(helper, settings, electronPowerEvents, undefined, logger);
    const rearm = new HotkeyRearm(permissions, hotkey, logger);
    const updates = createUpdates({
      e2e,
      dictation: coordinatorDictationGuard({ coordinator: () => coordinator, microphone: capture, meter: settingsServices.microphones, logger }),
      send: (status) => mainWindow.send('update-status-changed', status),
      logger,
    });
    registerIpc({
      settings,
      stats: home.stats,
      status: home.status,
      lastTranscript,
      permissions,
      recorder: new KeyRecorder(helper),
      hotkey: { isArmed: () => rearm.settled().then(() => hotkey.isArmed()) },
      relaunch,
      catalog: models.catalog,
      models: models.manager,
      actions: settingsServices.actions,
      microphones: settingsServices.microphones,
      source: rendererSource(),
      updates: updates.service,
      openUpdateUrl: (url) => shell.openExternal(url),
    });
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
      updates: updates.service,
      openApp: () => mainWindow.open(),
      openSettings: () => mainWindow.open('settings'),
      quit: () => app.quit(),
      logger,
    });
    views.add((state) => tray.reflect(state));
    overlay.onAction((action) => coordinator.act(action));
    coordinator.start();
    tray.create();
    updates.start();
    disposers.push(
      () => rearm.dispose(),
      () => coordinator.dispose(),
      () => hotkey.dispose(),
      () => tray.destroy(),
      () => overlay.destroy(),
      () => home.dispose(),
      () => settingsServices.dispose(),
      () => updates.dispose(),
    );
    exposeE2eHooks(e2e, { capture, overlay, lastTranscript, helper, updater: updates.fake, loadUpdater: loadAutoUpdater });
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
    beforeQuit: (event) => quitGate.handle(event),
    dispose: () => {
      disposeAll();
      void startedHelper?.stop();
    },
  };
}
