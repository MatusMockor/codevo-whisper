import { app, type BrowserWindow } from 'electron';
import { EVENT_CHANNELS } from '../../shared/ipc-contract';
import type { PageId } from '../../shared/pages';
import { createMainWindow } from './main-window';

export class MainWindowController {
  private window: BrowserWindow | null = null;

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

  private create(page: PageId | undefined): void {
    const window = createMainWindow(page);
    this.window = window;
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
