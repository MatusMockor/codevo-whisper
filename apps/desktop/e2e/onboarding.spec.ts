import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Settings } from '../src/shared/settings';
import { createUserDataDir, FAKE_MEDIA_ARGS, launchApp, removeUserDataDir } from './launch-app';

type FakeHelperGlobal = {
  codevoE2e: {
    helper: { recordedKey: number | null; requestedPermissions: string[]; permissionState: { listen: boolean; post: boolean; accessibility: boolean } };
    shell: { opened: string[]; revealed: string[] };
  };
};

const INPUT_MONITORING_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent';
const MANUAL_ADD_HINT = 'Ak tam Codevo Whisper nie je, kliknite v zozname na + a vyberte ju, alebo ju tam presuňte z Findera.';

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

function setInputPermissions(listen: boolean, accessibility = true): Promise<void> {
  return app.evaluate(
    (_electron, granted) => {
      (globalThis as unknown as FakeHelperGlobal).codevoE2e.helper.permissionState = { listen: granted.listen, post: true, accessibility: granted.accessibility };
    },
    { listen, accessibility },
  );
}

function requestedPermissions(): Promise<string[]> {
  return app.evaluate(() => [...(globalThis as unknown as FakeHelperGlobal).codevoE2e.helper.requestedPermissions]);
}

function openedUrls(): Promise<string[]> {
  return app.evaluate(() => [...(globalThis as unknown as FakeHelperGlobal).codevoE2e.shell.opened]);
}

function revealedPaths(): Promise<string[]> {
  return app.evaluate(() => [...(globalThis as unknown as FakeHelperGlobal).codevoE2e.shell.revealed]);
}

function permissionRow(title: string) {
  return page.locator('.perm', { hasText: title });
}

test('is shown on the first run instead of the main window', async () => {
  await expect(page.getByText('Krok 1 z 5')).toBeVisible();
  await expect(heading()).toHaveText('Prístup k mikrofónu');
  await expect(page.locator('.perm', { hasText: 'Mikrofón' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Sekcie aplikácie' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Späť' })).toHaveCount(0);
});

test('step 2 shows live permission status and offers Reštartovať when Input Monitoring stays off', async () => {
  await next();
  await expect(heading()).toHaveText('Monitorovanie vstupu a prístupnosť');
  const inputRow = permissionRow('Monitorovanie vstupu');
  await expect(inputRow).toContainText('Povolené');
  await expect(permissionRow('Prístupnosť')).toContainText('Povolené');

  await setInputPermissions(false);
  await expect(inputRow).toContainText('Zatiaľ nepovolené');
  await expect(page.getByRole('button', { name: 'Reštartovať' })).toHaveCount(0);
  await inputRow.getByRole('button', { name: 'Povoliť' }).click();
  await expect(page.getByRole('button', { name: 'Reštartovať' })).toBeVisible();

  await setInputPermissions(true);
  await expect(inputRow).toContainText('Povolené');
  await expect(page.getByRole('button', { name: 'Reštartovať' })).toHaveCount(0);
});

test('step 2 asks macOS once, then only opens System Settings and offers the Finder fallback, also after a relaunch', async () => {
  test.skip(process.platform !== 'darwin', 'The Finder fallback is offered on macOS only');
  await setInputPermissions(false, false);
  await next();
  const inputRow = permissionRow('Monitorovanie vstupu');
  const accessibilityRow = permissionRow('Prístupnosť');
  await expect(inputRow).toContainText('Zatiaľ nepovolené');
  await expect(page.getByText(MANUAL_ADD_HINT)).toHaveCount(0);

  await inputRow.getByRole('button', { name: 'Povoliť' }).click();
  await expect.poll(requestedPermissions).toEqual(['listen']);
  await expect(inputRow.getByRole('button', { name: 'Otvoriť Nastavenia systému' })).toBeVisible();
  expect(await openedUrls()).toEqual([]);
  await expect(page.getByText(MANUAL_ADD_HINT)).toHaveCount(1);
  await expect(inputRow.locator('xpath=following-sibling::*[1]')).toContainText(MANUAL_ADD_HINT);
  await expect(accessibilityRow.getByRole('button', { name: 'Povoliť' })).toBeVisible();

  await inputRow.getByRole('button', { name: 'Otvoriť Nastavenia systému' }).click();
  await expect.poll(openedUrls).toEqual([INPUT_MONITORING_PANE]);
  expect(await requestedPermissions()).toEqual(['listen']);

  await page.getByRole('button', { name: 'Zobraziť vo Finderi' }).click();
  await expect.poll(revealedPaths).toHaveLength(1);
  expect((await revealedPaths())[0]).toMatch(/\.app$/);

  await app.close();
  await start();
  await setInputPermissions(false, false);
  await next();
  await expect(permissionRow('Monitorovanie vstupu').getByRole('button', { name: 'Otvoriť Nastavenia systému' })).toBeVisible();
  await expect(permissionRow('Prístupnosť').getByRole('button', { name: 'Povoliť' })).toBeVisible();
  await expect(page.getByText(MANUAL_ADD_HINT)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Reštartovať' })).toBeVisible();
  expect(await requestedPermissions()).toEqual([]);
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
