import type { BrowserWindow, WebContents } from 'electron';
import { EVENT_CHANNELS, type IpcEventName, type IpcEvents } from '../../shared/ipc-contract';
import type { PageId } from '../../shared/pages';
import { Listeners } from '../helper/listeners';
import { consoleLogger, type Logger } from '../logging/logger';
import { createMainWindow } from './main-window';
import { foregroundPresentation, type WindowPresentation } from './window-presentation';

export type MainWindowEvents = {
  send<E extends IpcEventName>(event: E, payload: IpcEvents[E]): void;
  onFocus(listener: () => void): () => void;
  onClose(listener: () => void): () => void;
};

export class MainWindowController implements MainWindowEvents {
  private window: BrowserWindow | null = null;
  private readonly focusListeners: Listeners<void>;
  private readonly closeListeners: Listeners<void>;

  constructor(
    logger: Logger = consoleLogger,
    private readonly presentation: WindowPresentation = foregroundPresentation,
  ) {
    this.focusListeners = new Listeners(logger, 'A main window focus listener failed');
    this.closeListeners = new Listeners(logger, 'A main window close listener failed');
  }

  isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  open(page?: PageId): void {
    this.presentation.activateApp();
    const window = this.window;
    if (window === null || window.isDestroyed()) {
      this.create(page);
      return;
    }
    this.reveal(window);
    if (page === undefined) {
      return;
    }
    window.webContents.send(EVENT_CHANNELS['open-page'], page);
  }

  ownsContents(contents: WebContents): boolean {
    return this.isOpen() && this.window?.webContents === contents;
  }

  send<E extends IpcEventName>(event: E, payload: IpcEvents[E]): void {
    const window = this.window;
    if (window === null || window.isDestroyed()) {
      return;
    }
    window.webContents.send(EVENT_CHANNELS[event], payload);
  }

  onFocus(listener: () => void): () => void {
    return this.focusListeners.add(listener);
  }

  onClose(listener: () => void): () => void {
    return this.closeListeners.add(listener);
  }

  private create(page: PageId | undefined): void {
    const window = createMainWindow(page ?? 'home', this.presentation);
    this.window = window;
    window.on('focus', () => {
      this.focusListeners.emit();
    });
    window.once('closed', () => {
      if (this.window !== window) {
        return;
      }
      this.window = null;
      this.closeListeners.emit();
    });
  }

  private reveal(window: BrowserWindow): void {
    if (window.isMinimized()) {
      window.restore();
    }
    this.presentation.show(window);
  }
}
