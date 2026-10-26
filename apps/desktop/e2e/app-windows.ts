import type { ElectronApplication, Page } from '@playwright/test';

export const CAPTURE_PAGE = '/capture/capture.html';

export function isCapturePage(page: Page): boolean {
  return page.url().endsWith(CAPTURE_PAGE);
}

export function appWindows(app: ElectronApplication): Page[] {
  return app.windows().filter((page) => !isCapturePage(page));
}
