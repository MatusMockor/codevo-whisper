import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { appWindows } from './app-windows';
import { startExternalSite, type ExternalSite } from './external-site';
import { createUserDataDir, launchApp, ONBOARDED, removeUserDataDir } from './launch-app';

const SETTLE_MS = 750;

let app: ElectronApplication;
let page: Page;
let external: ExternalSite;
let userDataDir: string;

test.beforeEach(async () => {
  external = await startExternalSite();
  userDataDir = await createUserDataDir(ONBOARDED);
  app = await launchApp(userDataDir);
  page = await app.firstWindow();
});

test.afterEach(async () => {
  await app.close();
  await external.close();
  await removeUserDataDir(userDataDir);
});

test('shows a window titled Codevo Whisper with the sidebar sections', async () => {
  await expect(page).toHaveTitle('Codevo Whisper');
  const nativeTitle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle());
  expect(nativeTitle).toBe('Codevo Whisper');

  const sidebar = page.getByRole('tablist', { name: 'Sekcie aplikácie' });
  for (const label of ['Domov', 'Server', 'Nastavenia', 'Súkromie']) {
    await expect(sidebar.getByRole('tab', { name: label })).toBeVisible();
  }
});

test('switches pages from the sidebar', async () => {
  await page.getByRole('tab', { name: 'Nastavenia' }).click();

  await expect(page.getByRole('tab', { name: 'Nastavenia' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nastavenia');
});

test('the real window denies window.open', async () => {
  const popupBlocked = await page.evaluate((url) => window.open(url) === null, external.url);
  await page.waitForTimeout(SETTLE_MS);

  expect(popupBlocked).toBe(true);
  expect(appWindows(app)).toHaveLength(1);
  expect(external.requestCount()).toBe(0);
});

test('the real window blocks navigation to external URLs', async () => {
  const startUrl = page.url();

  await page.evaluate((url) => {
    window.location.href = url;
  }, external.url);
  await page.waitForTimeout(SETTLE_MS);

  expect(external.requestCount()).toBe(0);
  expect(page.url()).toBe(startUrl);
});

test('closing the main window keeps the app running in the tray and it opens again', async () => {
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  await expect(page.getByRole('meter', { name: 'Úroveň mikrofónu' })).toBeVisible();

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().endsWith('/renderer/index.html'))
      ?.close();
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.webContents.getURL().endsWith('/renderer/index.html')))).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

  const reopened = app.waitForEvent('window');
  await app.evaluate(({ app: electronApp }) => {
    electronApp.emit('activate');
  });
  const reopenedPage = await reopened;

  await expect(reopenedPage.getByRole('tablist', { name: 'Sekcie aplikácie' })).toBeVisible();
  await expect(reopenedPage.getByRole('tab', { name: 'Domov' })).toHaveAttribute('aria-selected', 'true');
  expect(await app.evaluate(({ app: electronApp }) => electronApp.isReady())).toBe(true);
  const heardAfterReopen = await reopenedPage.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          stop();
          resolve(false);
        }, 1500);
        const stop = window.codevo.on('microphone-level', () => {
          clearTimeout(timer);
          stop();
          resolve(true);
        });
      }),
  );
  expect(heardAfterReopen).toBe(false);
});
