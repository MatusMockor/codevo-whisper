import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { FakeAppUpdater } from '../src/main/updates/fake-app-updater';
import { createUserDataDir, FAKE_MEDIA_ARGS, launchApp, ONBOARDED, removeUserDataDir, type LaunchOptions } from './launch-app';

type UpdaterGlobal = { codevoE2e: { updater: Promise<FakeAppUpdater>; loadUpdater(): Promise<{ checkForUpdates(): Promise<unknown> }> } };

type FakeControl = Partial<Pick<FakeAppUpdater, 'latest' | 'checkFails' | 'holdDownloads'>>;

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let currentVersion: string;

async function start(options: LaunchOptions = {}): Promise<void> {
  userDataDir = await createUserDataDir(ONBOARDED);
  app = await launchApp(userDataDir, FAKE_MEDIA_ARGS, { fakeHelper: true, ...options });
  page = await app.firstWindow();
  currentVersion = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nastavenia');
}

function updatesRow(): Locator {
  return page.locator('.srow', { has: page.locator('b', { hasText: 'Aktualizácie' }) });
}

function control(values: FakeControl): Promise<void> {
  return app.evaluate(async (_electron, next) => {
    Object.assign(await (globalThis as unknown as UpdaterGlobal).codevoE2e.updater, next);
  }, values);
}

function fake<K extends 'installs' | 'downloads' | 'checks'>(key: K): Promise<number> {
  return app.evaluate(async (_electron, name) => (await (globalThis as unknown as UpdaterGlobal).codevoE2e.updater)[name], key);
}

function drive(action: 'reportProgress' | 'completeDownload' | 'failInstall', argument?: number | string): Promise<void> {
  return app.evaluate(
    async (_electron, { name, value }) => {
      const updater = await (globalThis as unknown as UpdaterGlobal).codevoE2e.updater;
      if (name === 'reportProgress') {
        updater.reportProgress(Number(value));
        return;
      }
      if (name === 'failInstall') {
        updater.failInstall(String(value));
        return;
      }
      updater.completeDownload();
    },
    { name: action, value: argument },
  );
}

test.afterEach(async () => {
  await app.close();
  await removeUserDataDir(userDataDir);
});

test('downloads a found update and restarts into it only after the confirmation', async () => {
  await start();
  const row = updatesRow();
  await expect(row).toContainText(`Verzia ${currentVersion}. Aktualizácie sa kontrolujú automaticky.`);
  await control({ latest: '9.9.9', holdDownloads: true });

  await row.getByRole('button', { name: 'Skontrolovať aktualizácie' }).click();
  await expect(row).toContainText('Sťahujem verziu 9.9.9… 0 %');
  await expect(row.getByRole('button', { name: 'Skontrolovať aktualizácie' })).toBeDisabled();
  await drive('reportProgress', 42);
  await expect(row).toContainText('Sťahujem verziu 9.9.9… 42 %');
  await drive('completeDownload');
  await expect(row).toContainText('Verzia 9.9.9 je pripravená. Nainštaluje sa po reštarte.');
  expect(await fake('installs')).toBe(0);

  await row.getByRole('button', { name: 'Reštartovať a aktualizovať' }).click();
  await expect(row).toContainText('Reštartujem a inštalujem verziu 9.9.9…');
  await expect(row.getByRole('button', { name: 'Reštartovať a aktualizovať' })).toBeDisabled();
  await expect.poll(() => fake('installs')).toBe(1);

  await drive('failInstall', 'Code signature did not pass validation');
  await expect(row).toContainText(`Aktualizáciu sa nepodarilo nainštalovať. Zostáva verzia ${currentVersion}.`);
});

test('reports the newest version and a failed check', async () => {
  await start();
  const row = updatesRow();

  await row.getByRole('button', { name: 'Skontrolovať aktualizácie' }).click();
  await expect(row).toContainText(`Verzia ${currentVersion} je najnovšia.`);
  await control({ checkFails: true });
  await row.getByRole('button', { name: 'Skontrolovať aktualizácie' }).click();

  await expect(row).toContainText('Aktualizácie sa nepodarilo skontrolovať. Skúste to neskôr.');
  expect(await fake('checks')).toBe(2);
});

test('a package without in-app updates shows the new version with a download link', async () => {
  await start({ updateMode: 'manual' });
  const row = updatesRow();
  await control({ latest: '9.9.9' });

  await row.getByRole('button', { name: 'Skontrolovať aktualizácie' }).click();

  await expect(row).toContainText('Je dostupná verzia 9.9.9. Stiahnite ju z GitHubu a nainštalujte.');
  await expect(row.getByRole('button', { name: 'Stiahnuť z GitHubu' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Reštartovať a aktualizovať' })).toHaveCount(0);
  expect(await fake('downloads')).toBe(0);
});

test('the bundled electron-updater loads in the main process and stays inactive unpackaged', async () => {
  await start();

  const loaded = await app.evaluate(async () => {
    const updater = await (globalThis as unknown as UpdaterGlobal).codevoE2e.loadUpdater();
    return { check: typeof updater.checkForUpdates, result: await updater.checkForUpdates() };
  });

  expect(loaded).toEqual({ check: 'function', result: null });
});
