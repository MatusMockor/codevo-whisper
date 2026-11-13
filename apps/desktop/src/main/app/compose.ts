import { app, desktopCapturer, powerMonitor, session, shell, webContents } from 'electron';
import { join } from 'node:path';
import { prewarmWhenShown } from '../audio/capture-prewarm';
import { CaptureWindow } from '../audio/capture-window';
import { WindowAudioCapture } from '../audio/window-audio-capture';
import type { InputHelper } from '../helper/input-helper';
import { EngineOrderQueue } from '../engines/engine-order-queue';
import { EngineRouting } from '../engines/engine-routing';
import { EngineSelector } from '../engines/engine-selector';
import { Listeners } from '../helper/listeners';
import { electronPowerEvents } from '../hotkey/electron-power-events';
import { HistoryStore } from '../history/history-store';
import { HotkeyService } from '../hotkey/hotkey-service';
import { KeyRecorder } from '../hotkey/key-recorder';
import { HotkeyRearm } from '../hotkey/rearm-on-grant';
import { InsertionService } from '../insertion/insertion-service';
import { LastTranscript } from '../insertion/last-transcript';
import { registerIpc } from '../ipc/register-ipc';
import type { Logger } from '../logging/logger';
import { ActiveModelReadiness } from '../models/local-model-readiness';
import { AskedPermissionsStore } from '../permissions/asked-permissions-store';
import { electronMicrophoneAccess } from '../permissions/electron-microphone-access';
import { MACOS_PERMISSION_LINKS } from '../permissions/macos-permission-links';
import { PermissionsService } from '../permissions/permissions-service';
import { appFrameCheck } from '../security/app-frame';
import { installContentSecurityPolicy } from '../security/content-security-policy';
import { installDisplayMediaHandler } from '../security/display-media';
import { installPermissionHandlers } from '../security/permissions';
import { PauseState } from '../session/pause-state';
import { SessionCoordinator } from '../session/session-coordinator';
import { FailedRecording } from '../session/failed-recording';
import { SettingsStore } from '../settings/settings-store';
import { AppReveal } from '../system/app-reveal';
import { homeRelativePath } from '../system/home-relative-path';
import { RecordingDesktopShell, type DesktopShell } from '../system/desktop-shell';
import { coordinatorDictationGuard } from '../updates/coordinator-dictation-guard';
import { TrayMenu } from '../tray/tray-menu';
import { MainWindowController } from '../windows/main-window-controller';
import { OverlayWindow } from '../windows/overlay-window';
import { SectionFocus } from '../windows/section-focus';
import { rendererSource } from '../windows/renderer-source';
import { backgroundPresentation, foregroundPresentation } from '../windows/window-presentation';
import type { OverlayState } from '../../shared/overlay-contract';
import { createAiServices, type AiServices } from './ai-wiring';
import { exposeE2eHooks } from './e2e-hooks';
import { createHomeServices } from './home-wiring';
import { createMeetings, type Meetings } from './meeting-wiring';
import { createInputHelper } from './input-helper-factory';
import { createModels, pickModelFile } from './model-wiring';
import { createServerServices } from './server-wiring';
import { createSettingsServices, migrateLanguageSettings } from './settings-wiring';
import { QuitGate, type QuitEvent } from './quit-gate';
import { startInput } from './start-input';
import { isE2eMode } from './test-mode';
import { createUpdates, loadAutoUpdater } from './update-wiring';

const SETTINGS_FILE = 'settings.json';
const ASKED_PERMISSIONS_FILE = 'asked-permissions.json';

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
    displayCapture: process.platform === 'darwin',
  });
  installDisplayMediaHandler(session.defaultSession, {
    isCaptureFrame: (contents, url) => captureWindow.isCaptureFrame(contents, url),
    contentsOf: (frame) => webContents.fromFrame(frame) ?? null,
    screens: () => desktopCapturer.getSources({ types: ['screen'] }),
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
  let sessions: SessionCoordinator | null = null;
  let meetings: Meetings | null = null;
  let ai: AiServices | null = null;
  const history = new HistoryStore(join(app.getPath('userData'), 'history.json'), logger);
  const shutdown = async (): Promise<void> => {
    await meetings?.shutdown();
    await ai?.shutdown();
    await sessions?.shutdown();
    await capture.settled();
    await history.settled();
  };
  const quitGate = new QuitGate({ isBusy: () => capture.isBusy() || (sessions?.isBusy() ?? false) || history.isBusy() || (meetings?.isBusy() ?? false) || (ai?.isBusy() ?? false), settled: shutdown }, () => app.quit(), logger);
  const allowShutdown = (): void => quitGate.systemShuttingDown();
  const recordingShell = e2e ? new RecordingDesktopShell() : null;
  const desktopShell: DesktopShell = recordingShell ?? shell;

  function disposeAll(): void {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
  }

  async function relaunch(): Promise<void> {
    await shutdown();
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
    await history.view();
    disposers.push(history.onChange((view) => mainWindow.send('history-changed', view)));
    const models = createModels(settings, logger);
    disposers.push(models.languagePack.onChange((view) => mainWindow.send('language-pack-changed', view)));
    await migrateLanguageSettings({ settings, models: models.manager, logger });
    const aiServices = createAiServices({ settings, e2e, isPackaged: app.isPackaged, logger });
    ai = aiServices;
    meetings = createMeetings({ captureWindow, capture, models: models.manager, diarizer: models.diarizer, settings, window: mainWindow, provider: () => aiServices.provider(), logger });
    await meetings.load();
    const pause = new PauseState(logger);
    const input = Promise.withResolvers<void>();
    const permissions = new PermissionsService({
      helper,
      microphone: electronMicrophoneAccess,
      links: process.platform === 'linux' ? { microphone: 'help:gnome-help/sound-usespeaker', 'input-monitoring': 'help:gnome-help', accessibility: 'help:gnome-help/a11y' } : MACOS_PERMISSION_LINKS,
      platform: process.platform,
      openUrl: (url) => desktopShell.openExternal(url),
      asked: new AskedPermissionsStore(join(app.getPath('userData'), ASKED_PERMISSIONS_FILE), logger),
      logger,
      inputReady: input.promise,
    });
    const localModel = new ActiveModelReadiness(models.manager, settings);
    const order = new EngineOrderQueue(settings);
    const server = createServerServices({ settings, order, local: localModel, window: mainWindow, power: electronPowerEvents, e2e, isPackaged: app.isPackaged, logger });
    const routing = new EngineRouting({ order, local: localModel, server: server.service });
    const sectionFocus = new SectionFocus(mainWindow);
    const home = createHomeServices({ settings, models: models.manager, permissions, pause, lastTranscript, server: server.service, window: mainWindow, logger });
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
      helper,
      settings,
      stats: home.stats,
      history,
      status: home.status,
      lastTranscript,
      permissions,
      appReveal: new AppReveal({ platform: process.platform, executablePath: app.getPath('exe'), shell: desktopShell }),
      recorder: new KeyRecorder(helper, hotkey),
      hotkey: { isArmed: () => rearm.settled().then(() => hotkey.isArmed()) },
      relaunch,
      catalog: models.catalog,
      models: models.manager,
      actions: settingsServices.actions,
      languagePack: models.languagePack,
      pickModelFile,
      microphones: settingsServices.microphones,
      server: server.service,
      order,
      routing,
      sectionFocus,
      source: rendererSource(),
      updates: updates.service,
      openUpdateUrl: (url) => shell.openExternal(url),
      ai: aiServices,
      meetings,
      dataFolder: () => homeRelativePath(app.getPath('userData'), app.getPath('home')),
    });
    const insertion = new InsertionService(helper, settings, lastTranscript, undefined, logger);
    const overlay = new OverlayWindow(rendererSource('overlay'), logger);
    const views = new Listeners<OverlayState>(logger, 'An overlay view failed');
    views.add((state) => overlay.show(state));
    const failedRecording = new FailedRecording();
    const coordinator = new SessionCoordinator({
      hotkey,
      capture,
      engines: new EngineSelector([models.engine, server.engine]),
      routing,
      insertion,
      lastTranscript,
      helper,
      settings,
      stats: home.stats,
      history,
      pause,
      overlay: (state) => views.emit(state),
      openSettings: () => mainWindow.open('settings'),
      openLanguageSettings: () => sectionFocus.revealSetting('languages'),
      openServer: () => sectionFocus.reveal('server'),
      openModelSettings: () => sectionFocus.reveal('local-model'),
      enableServer: () => server.service.setEnabled(true),
      polish: (request, signal) => aiServices.polish(request, signal),
      failedRecording,
      appIcon: (path) => app.getFileIcon(path, { size: 'normal' }).then((icon) => icon.toDataURL(), () => null),
      logger,
    });
    sessions = coordinator;
    const tray = new TrayMenu({
      platform: process.platform,
      coordinator,
      failedRecording,
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
      () => server.dispose(),
      () => { void models.dispose().catch((error: unknown) => logger.error('Local model shutdown failed', error)); },
      () => updates.dispose(),
      prewarmWhenShown(mainWindow, captureWindow),
    );
    exposeE2eHooks(e2e, { capture, overlay, lastTranscript, helper, shell: recordingShell, updater: updates.fake, loadUpdater: loadAutoUpdater });
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
      void shutdown().then(() => startedHelper?.stop()).catch((error: unknown) => logger.error('Recording audio shutdown failed', error));
    },
  };
}
