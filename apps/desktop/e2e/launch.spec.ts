import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { startExternalSite, type ExternalSite } from './external-site';
import { launchApp } from './launch-app';

const SETTLE_MS = 750;

let app: ElectronApplication;
let page: Page;
let external: ExternalSite;

test.beforeEach(async () => {
  external = await startExternalSite();
  app = await launchApp();
  page = await app.firstWindow();
});

test.afterEach(async () => {
  await app.close();
  await external.close();
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
  expect(app.windows()).toHaveLength(1);
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
