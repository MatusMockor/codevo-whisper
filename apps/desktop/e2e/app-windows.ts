import { expect, type ElectronApplication, type Page } from '@playwright/test';

export const CAPTURE_PAGE = '/capture/capture.html';

export const MAIN_PAGE = '/renderer/index.html';

const MAIN_WINDOW_TIMEOUT_MS = 30_000;

export function isCapturePage(page: Page): boolean {
  return page.url().endsWith(CAPTURE_PAGE);
}

export function isMainPage(page: Page): boolean {
  return (page.url().split('#')[0] ?? '').endsWith(MAIN_PAGE);
}

export function appWindows(app: ElectronApplication): Page[] {
  return app.windows().filter((page) => !isCapturePage(page));
}

export async function mainWindow(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some(isMainPage), { timeout: MAIN_WINDOW_TIMEOUT_MS }).toBe(true);
  const page = app.windows().find(isMainPage);
  expect(page).toBeDefined();
  const main = page as Page;
  await main.waitForLoadState('domcontentloaded');
  return main;
}
