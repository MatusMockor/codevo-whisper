import { app, type BrowserWindow, type WebContents } from 'electron';
import { EVENT_CHANNELS, type IpcEventName, type IpcEvents } from '../../shared/ipc-contract';
import type { PageId } from '../../shared/pages';
import { Listeners } from '../helper/listeners';
import { consoleLogger, type Logger } from '../logging/logger';
import { createMainWindow } from './main-window';

export type MainWindowEvents = {
  send<E extends IpcEventName>(event: E, payload: IpcEvents[E]): void;
  onFocus(listener: () => void): () => void;
};

export class MainWindowController implements MainWindowEvents {
  private window: BrowserWindow | null = null;
  private readonly focusListeners: Listeners<void>;

  constructor(logger: Logger = consoleLogger) {
    this.focusListeners = new Listeners(logger, 'A main window focus listener failed');
  }

  isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  open(page?: PageId): void {
    app.focus({ steal: true });
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

  private create(page: PageId | undefined): void {
    const window = createMainWindow(page);
    this.window = window;
    window.on('focus', () => {
      this.focusListeners.emit();
    });
    window.once('closed', () => {
      if (this.window === window) {
        this.window = null;
      }
    });
  }

  private reveal(window: BrowserWindow): void {
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
  }
}
