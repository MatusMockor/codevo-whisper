import { Menu, Tray } from 'electron';
import type { AudioCapture } from '../audio/audio-capture';
import type { AudioDevice } from '../audio/device-resolver';
import type { ActiveModel } from '../engines/active-model';
import type { LastTranscript } from '../insertion/last-transcript';
import type { Logger } from '../logging/logger';
import type { SessionCoordinator } from '../session/session-coordinator';
import type { SettingsStore } from '../settings/settings-store';
import type { UpdateService } from '../updates/update-service';
import type { OverlayState } from '../../shared/overlay-contract';
import { canCheckForUpdates } from '../../shared/updates';
import { SPIN_FRAME_MS, TrayIcons } from './tray-icons';
import { trayMenuTemplate, type TrayMenuActions, type TrayMenuModel } from './tray-menu-template';
import { IDLE, nextActivity, statusLine, trayIconKind, type TrayActivity, type TrayIconKind } from './tray-status';

const DEVICE_LIST_TIMEOUT_MS = 800;

export type TrayMenuDeps = {
  platform: NodeJS.Platform;
  coordinator: Pick<SessionCoordinator, 'pasteLast' | 'copyLast' | 'pause' | 'resume' | 'isPaused'>;
  capture: Pick<AudioCapture, 'listDevices'>;
  settings: Pick<SettingsStore, 'get' | 'update' | 'onChange'>;
  lastTranscript: Pick<LastTranscript, 'get' | 'onChange'>;
  models: Pick<ActiveModel, 'activeLanguageHint'>;
  updates: Pick<UpdateService, 'status' | 'install' | 'check' | 'onChange'>;
  openApp(): void;
  openSettings(): void;
  quit(): void;
  logger: Logger;
};

export class TrayMenu {
  private tray: Tray | null = null;
  private activity: TrayActivity = IDLE;
  private devices: AudioDevice[] = [];
  private spinner: NodeJS.Timeout | null = null;
  private frame = 0;
  private shownKind: TrayIconKind = 'idle';
  private readonly icons: TrayIcons;
  private attachedMenu: string | null = null;
  private unsubscribers: Array<() => void> = [];

  constructor(private readonly deps: TrayMenuDeps) {
    this.icons = new TrayIcons(deps.platform);
  }

  create(): void {
    const tray = new Tray(this.icons.image('idle'));
    tray.setToolTip('Codevo Whisper');
    this.tray = tray;
    if (this.deps.platform !== 'linux') {
      tray.on('click', () => this.popUp());
      tray.on('right-click', () => this.popUp());
      return;
    }
    tray.on('click', () => this.deps.openApp());
    const attach = () => this.attachMenu();
    this.unsubscribers = [this.deps.settings.onChange(attach), this.deps.lastTranscript.onChange(attach), this.deps.updates.onChange(attach)];
    this.attachMenu();
    this.attachMenuWithFreshDevices();
  }

  reflect(state: OverlayState): void {
    const previous = this.activity;
    this.activity = nextActivity(previous, state);
    this.refreshIcon();
    if (this.deps.platform !== 'linux') {
      return;
    }
    if (this.activity.kind === 'idle' && previous.kind !== 'idle') {
      this.attachMenuWithFreshDevices();
      return;
    }
    this.attachMenu();
  }

  destroy(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.stopSpinner();
    this.tray?.destroy();
    this.tray = null;
  }

  private popUp(): void {
    this.freshDevices()
      .then((devices) => {
        this.devices = devices;
        this.tray?.popUpContextMenu(Menu.buildFromTemplate(trayMenuTemplate(this.model(), this.actions())));
      })
      .catch((error: unknown) => {
        this.deps.logger.error('The tray menu could not be opened', error);
      });
  }

  private attachMenuWithFreshDevices(): void {
    void this.freshDevices().then((devices) => {
      this.devices = devices;
      this.attachMenu();
    });
  }

  private attachMenu(): void {
    const model = this.model();
    const key = JSON.stringify(model);
    if (this.tray === null || key === this.attachedMenu) {
      return;
    }
    this.attachedMenu = key;
    this.tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(model, this.actions())));
  }

  private freshDevices(): Promise<AudioDevice[]> {
    const listed = this.deps.capture.listDevices().catch((error: unknown) => {
      this.deps.logger.error('The microphones could not be listed for the tray menu', error);
      return this.devices;
    });
    let timer: NodeJS.Timeout | undefined;
    const fallback = new Promise<AudioDevice[]>((resolve) => {
      timer = setTimeout(() => resolve(this.devices), DEVICE_LIST_TIMEOUT_MS);
    });
    return Promise.race([listed, fallback]).finally(() => clearTimeout(timer));
  }

  private model(): TrayMenuModel {
    const settings = this.deps.settings.get();
    const paused = this.deps.coordinator.isPaused();
    return {
      status: statusLine(this.activity, paused, settings),
      lastTranscript: this.deps.lastTranscript.get(),
      paused,
      devices: this.devices,
      microphone: settings.microphone,
      language: settings.language,
      autoLanguageAllowed: this.deps.models.activeLanguageHint() !== 'required',
      readyUpdate: this.readyUpdate(),
      installingUpdate: this.installingUpdate(),
      updateCheckable: canCheckForUpdates(this.deps.updates.status()),
    };
  }

  private actions(): TrayMenuActions {
    const { coordinator, settings, logger } = this.deps;
    const report = (message: string) => (error: unknown) => logger.error(message, error);
    return {
      copyLast: () => void coordinator.copyLast().catch(report('Copying the last transcript from the tray failed')),
      pasteLast: () => void coordinator.pasteLast().catch(report('Pasting the last transcript from the tray failed')),
      togglePause: () => this.togglePause(),
      chooseMicrophone: (microphone) => void settings.update({ microphone }).catch(report('The microphone could not be saved')),
      chooseLanguage: (language) => void settings.update({ language }).catch(report('The language could not be saved')),
      openApp: () => this.deps.openApp(),
      openSettings: () => this.deps.openSettings(),
      quit: () => this.deps.quit(),
      installUpdate: () => this.installUpdate(),
      checkForUpdates: () => this.checkForUpdates(),
    };
  }

  private readyUpdate(): string | null {
    const phase = this.deps.updates.status().phase;
    return phase.kind === 'ready' ? phase.version : null;
  }

  private installingUpdate(): boolean {
    const { kind } = this.deps.updates.status().phase;
    return kind === 'installing' || kind === 'stalled';
  }

  private installUpdate(): void {
    this.deps.updates
      .install()
      .then((outcome) => {
        if (outcome === 'restarting') {
          return;
        }
        this.deps.logger.info('The update was not installed from the tray', { outcome });
      })
      .catch((error: unknown) => {
        this.deps.logger.error('Installing the update from the tray failed', error);
      });
  }

  private checkForUpdates(): void {
    this.deps.openApp();
    this.deps.updates.check().catch((error: unknown) => {
      this.deps.logger.error('Checking for updates from the tray failed', error);
    });
  }

  private togglePause(): void {
    if (this.installingUpdate()) {
      this.deps.logger.info('Dictation stays paused while the update installs', null);
      return;
    }
    const { coordinator } = this.deps;
    const toggle = coordinator.isPaused() ? () => coordinator.resume() : () => coordinator.pause();
    toggle();
    this.refreshIcon();
    if (this.deps.platform === 'linux') {
      this.attachMenu();
    }
  }

  private refreshIcon(): void {
    const kind = trayIconKind(this.activity, this.deps.coordinator.isPaused());
    if (kind === this.shownKind) {
      return;
    }
    this.shownKind = kind;
    if (kind !== 'processing') {
      this.stopSpinner();
      this.tray?.setImage(this.icons.image(kind));
      return;
    }
    this.tray?.setImage(this.icons.image('processing', this.frame));
    this.spinner = setInterval(() => {
      this.frame += 1;
      this.tray?.setImage(this.icons.image('processing', this.frame));
    }, SPIN_FRAME_MS);
  }

  private stopSpinner(): void {
    if (this.spinner === null) {
      return;
    }
    clearInterval(this.spinner);
    this.spinner = null;
    this.frame = 0;
  }
}
