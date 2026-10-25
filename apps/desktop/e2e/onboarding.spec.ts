import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Settings } from '../src/shared/settings';
import { createUserDataDir, FAKE_MEDIA_ARGS, launchApp, removeUserDataDir } from './launch-app';

type FakeHelperGlobal = { codevoE2e: { helper: { recordedKey: number | null; permissionState: { listen: boolean; post: boolean; accessibility: boolean } } } };

const DEFAULT_MODEL_NAME = process.arch === 'arm64' ? 'Parakeet Ultra' : 'Parakeet Ultra (malý)';

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

async function start(): Promise<void> {
  app = await launchApp(userDataDir, FAKE_MEDIA_ARGS, { fakeHelper: true });
  page = await app.firstWindow();
}

test.beforeEach(async () => {
  userDataDir = await createUserDataDir();
  await start();
});

test.afterEach(async () => {
  await app.close();
  await removeUserDataDir(userDataDir);
});

function heading() {
  return page.getByRole('heading', { level: 1 });
}

function next(): Promise<void> {
  return page.getByRole('button', { name: 'Ďalej' }).click();
}

function setInputMonitoring(listen: boolean): Promise<void> {
  return app.evaluate((_electron, granted) => {
    (globalThis as unknown as FakeHelperGlobal).codevoE2e.helper.permissionState = { listen: granted, post: true, accessibility: true };
  }, listen);
}

function stubSystemSettings(): Promise<void> {
  return app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('permissions:open-settings');
    ipcMain.handle('permissions:open-settings', () => undefined);
  });
}

test('is shown on the first run instead of the main window', async () => {
  await expect(page.getByText('Krok 1 z 5')).toBeVisible();
  await expect(heading()).toHaveText('Prístup k mikrofónu');
  await expect(page.locator('.perm', { hasText: 'Mikrofón' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Sekcie aplikácie' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Späť' })).toHaveCount(0);
});

test('step 2 shows live permission status and offers Reštartovať when Input Monitoring stays off', async () => {
  await stubSystemSettings();
  await next();
  await expect(heading()).toHaveText('Monitorovanie vstupu a prístupnosť');
  const inputRow = page.locator('.perm', { hasText: 'Monitorovanie vstupu' });
  await expect(inputRow).toContainText('Povolené');
  await expect(page.locator('.perm', { hasText: 'Prístupnosť' })).toContainText('Povolené');

  await setInputMonitoring(false);
  await expect(inputRow).toContainText('Zatiaľ nepovolené');
  await inputRow.getByRole('button', { name: 'Otvoriť Nastavenia systému' }).click();
  await expect(page.getByRole('button', { name: 'Reštartovať' })).toBeVisible();

  await setInputMonitoring(true);
  await expect(inputRow).toContainText('Povolené');
  await expect(page.getByRole('button', { name: 'Reštartovať' })).toHaveCount(0);
});

test('walks through the hotkey and the preselected recommended model, then is skipped after completion', async () => {
  await next();
  await next();
  await expect(heading()).toHaveText('Klávesová skratka');
  await app.evaluate(() => {
    (globalThis as unknown as FakeHelperGlobal).codevoE2e.helper.recordedKey = 62;
  });
  await page.locator('.hk').click();
  await expect(page.locator('.hk')).toContainText('Pravý ⌃ Control');

  await next();
  await expect(heading()).toHaveText('Model na prepis');
  await expect(page.getByRole('radio', { name: DEFAULT_MODEL_NAME, exact: true })).toBeChecked();
  await expect(page.getByRole('radio')).toHaveCount(4);
  await expect(page.locator('.ob-model-actions').getByRole('button', { name: `Stiahnuť: ${DEFAULT_MODEL_NAME}` })).toBeVisible();
  await page.getByRole('radio', { name: 'Canary 1B v2' }).check();
  await expect(page.locator('.ob-model-actions').getByRole('button', { name: 'Stiahnuť: Canary 1B v2' })).toBeVisible();

  await next();
  await expect(heading()).toHaveText('Vyskúšajte to');
  await expect(page.locator('.ob-try')).toHaveText('Podržte Pravý ⌃ Control a povedzte niečo.');
  await page.getByRole('button', { name: 'Dokončiť' }).click();

  await expect(page.getByRole('tablist', { name: 'Sekcie aplikácie' })).toBeVisible();
  await expect.poll(async () => (JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as Settings).onboardingDone).toBe(true);

  await app.close();
  await start();
  await expect(page.getByRole('tablist', { name: 'Sekcie aplikácie' })).toBeVisible();
  await expect(page.getByText('Krok 1 z 5')).toHaveCount(0);
});
