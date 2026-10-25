import { app, type BrowserWindow } from 'electron';

export type WindowPresentation = {
  activateApp(): void;
  show(window: BrowserWindow): void;
  isActive(window: BrowserWindow): boolean;
};

function isOnScreen(window: BrowserWindow): boolean {
  return !window.isDestroyed() && window.isVisible() && !window.isMinimized();
}

export const foregroundPresentation: WindowPresentation = {
  activateApp: () => app.focus({ steal: true }),
  isActive: (window) => isOnScreen(window) && window.isFocused(),
  show: (window) => window.show(),
};

export const backgroundPresentation: WindowPresentation = {
  activateApp: () => undefined,
  isActive: isOnScreen,
  show: (window) => window.showInactive(),
};

export function runInBackground(): void {
  if (process.platform !== 'darwin') {
    return;
  }
  app.setActivationPolicy('accessory');
}
