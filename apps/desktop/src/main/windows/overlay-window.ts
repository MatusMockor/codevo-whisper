import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron';
import { fileURLToPath } from 'node:url';
import { isOverlayAction, OVERLAY_CHANNELS, type OverlayAction, type OverlayState } from '../../shared/overlay-contract';
import { Listeners } from '../helper/listeners';
import { isTrustedSenderUrl } from '../ipc/trusted-sender';
import type { Logger } from '../logging/logger';
import { loadSource } from './load-source';
import { bottomCenter, OVERLAY_SIZE } from './overlay-placement';
import type { RendererSource } from './renderer-source';

const HIDDEN: OverlayState = { kind: 'hidden' };

function createPanel(): BrowserWindow {
  const window = new BrowserWindow({
    type: 'panel',
    ...OVERLAY_SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    focusable: false,
    acceptFirstMouse: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/overlay.cjs', import.meta.url)),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  return window;
}

function isInteractive(state: OverlayState): boolean {
  return state.kind === 'blocked' || (state.kind === 'error' && state.action !== undefined);
}

export class OverlayWindow {
  private window: BrowserWindow | null = null;
  private ready: Promise<BrowserWindow> | null = null;
  private latest: OverlayState = HIDDEN;
  private readonly actions: Listeners<OverlayAction>;

  constructor(
    private readonly source: RendererSource,
    private readonly logger: Logger,
  ) {
    this.actions = new Listeners(logger, 'An overlay action listener failed');
    ipcMain.on(OVERLAY_CHANNELS.action, (event, payload: unknown) => {
      this.handleAction(event, payload);
    });
  }

  show(state: OverlayState): void {
    this.latest = state;
    if (state.kind === 'hidden') {
      this.window?.hide();
      return;
    }
    this.ensure().then(
      (window) => this.present(window),
      (error: unknown) => this.logger.error('The overlay could not be shown', error),
    );
  }

  onAction(listener: (action: OverlayAction) => void): () => void {
    return this.actions.add(listener);
  }

  destroy(): void {
    const window = this.window;
    this.forget();
    if (window === null || window.isDestroyed()) {
      return;
    }
    window.destroy();
  }

  private present(window: BrowserWindow): void {
    if (window.isDestroyed()) {
      return;
    }
    const state = this.latest;
    window.webContents.send(OVERLAY_CHANNELS.state, state);
    if (state.kind === 'hidden') {
      window.hide();
      return;
    }
    window.setIgnoreMouseEvents(!isInteractive(state));
    if (window.isVisible()) {
      return;
    }
    window.setBounds(bottomCenter(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea));
    window.showInactive();
  }

  private ensure(): Promise<BrowserWindow> {
    if (this.ready !== null) {
      return this.ready;
    }
    const window = createPanel();
    this.window = window;
    window.webContents.once('render-process-gone', () => {
      this.forget();
      window.destroy();
    });
    window.once('closed', () => {
      if (this.window === window) {
        this.forget();
      }
    });
    this.ready = loadSource(window, this.source).then(
      () => window,
      (error: unknown) => {
        this.forget();
        window.destroy();
        throw error;
      },
    );
    return this.ready;
  }

  private forget(): void {
    this.window = null;
    this.ready = null;
  }

  private handleAction(event: IpcMainEvent, payload: unknown): void {
    if (!this.isTrustedEvent(event)) {
      this.logger.error('Rejected overlay IPC from an untrusted sender', OVERLAY_CHANNELS.action);
      return;
    }
    if (!isOverlayAction(payload)) {
      this.logger.error('Rejected an invalid overlay action', typeof payload);
      return;
    }
    this.actions.emit(payload);
  }

  private isTrustedEvent(event: IpcMainEvent): boolean {
    const window = this.window;
    const frame = event.senderFrame;
    if (window === null || window.isDestroyed() || frame === null || frame.parent !== null) {
      return false;
    }
    return event.sender.id === window.webContents.id && isTrustedSenderUrl(frame.url, this.source);
  }
}
