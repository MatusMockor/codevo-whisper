import { app, type BrowserWindow } from 'electron';

export type WindowPresentation = {
  activateApp(): void;
  show(window: BrowserWindow): void;
};

export const foregroundPresentation: WindowPresentation = {
  activateApp: () => app.focus({ steal: true }),
  show: (window) => window.show(),
};

export const backgroundPresentation: WindowPresentation = {
  activateApp: () => undefined,
  show: (window) => window.showInactive(),
};

export function runInBackground(): void {
  if (process.platform !== 'darwin') {
    return;
  }
  app.setActivationPolicy('accessory');
}
