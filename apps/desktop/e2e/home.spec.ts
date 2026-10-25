import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { E2eHooks } from '../src/main/app/e2e-hooks';
import { addDays, localDate, weekStart } from '../src/shared/calendar-date';
import type { AppStatus } from '../src/shared/app-status';
import type { DayStats } from '../src/shared/stats';
import { createUserDataDir, launchApp, removeUserDataDir } from './launch-app';

type HookGlobal = { codevoE2e: E2eHooks };

const RIGHT_CONTROL = { keycode: 62, label: 'Pravý ⌃ Control' } as const;
const READY: AppStatus = { hotkeyLabel: RIGHT_CONTROL.label, modelReady: true, permissionsOk: true, paused: false };
const TRANSCRIPT = 'Ahoj Peter, pozrel som si ten pull request.';

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

async function start(): Promise<void> {
  app = await launchApp(userDataDir);
  page = await app.firstWindow();
}

test.beforeEach(async () => {
  userDataDir = await createUserDataDir();
});

test.afterEach(async () => {
  await app.close();
  await removeUserDataDir(userDataDir);
});

function banner(): Locator {
  return page.locator('.banner');
}

function tile(label: string): Locator {
  return page.locator('.tiles > div', { hasText: label }).locator('.v');
}

function pushStatus(status: AppStatus): Promise<void> {
  return app.evaluate(({ BrowserWindow }, pushed) => {
    BrowserWindow.getAllWindows()
      .find((window) => window.getTitle() === 'Codevo Whisper')
      ?.webContents.send('status:changed', pushed);
  }, status);
}

test('banner shows the call to action or the hotkey label', async () => {
  await start();

  await expect(banner()).toContainText('Nastavte klávesovú skratku, ktorou budete diktovať.');
  await page.getByRole('button', { name: 'Otvoriť nastavenia' }).click();
  await expect(page.getByRole('tab', { name: 'Nastavenia' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Domov' }).click();

  await page.evaluate((hotkey) => window.codevo.updateSettings({ hotkey }), RIGHT_CONTROL);
  await expect(banner()).toContainText('Stiahnite si model na prepis reči.');

  await expect(async () => {
    await pushStatus(READY);
    await expect(banner()).toHaveText('Všetko je pripravené. Podržte Pravý ⌃ Control v ľubovoľnej aplikácii a hovorte.', { timeout: 500 });
  }).toPass();
  await expect(banner().locator('kbd')).toHaveText(RIGHT_CONTROL.label);
});

test('tiles show values from seeded stats and switch periods', async () => {
  const today = localDate(new Date());
  const monday = weekStart(today);
  const days: DayStats[] = [
    { date: addDays(today, -40), words: 300, dictations: 10, seconds: 150 },
    ...(monday === today ? [] : [{ date: monday, words: 80, dictations: 2, seconds: 40 }]),
    { date: today, words: 120, dictations: 4, seconds: 60 },
  ];
  const mondayWords = monday === today ? 0 : 80;
  await writeFile(join(userDataDir, 'stats.json'), JSON.stringify({ version: 1, days }));
  await start();

  await expect(page.getByRole('button', { name: 'Dnes' })).toHaveAttribute('aria-pressed', 'true');
  await expect(tile('Nadiktované slová')).toHaveText('120');
  await expect(tile('Počet diktovaní')).toHaveText('4');
  await expect(tile('Čas diktovania')).toHaveText('1 min');
  await expect(tile('Priemerná rýchlosť')).toHaveText('120slov/min');
  await expect(tile('Ušetrený čas')).toHaveText('2 min');
  await expect(page.locator('.week-top span')).toHaveText(`spolu ${120 + mondayWords}`);
  await expect(page.getByText('Štatistiky sú len súčty čísel na tomto Macu, bez textu.')).toBeVisible();

  await page.getByRole('button', { name: 'Tento týždeň' }).click();
  await expect(page.getByRole('button', { name: 'Tento týždeň' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Dnes' })).toHaveAttribute('aria-pressed', 'false');
  await expect(tile('Nadiktované slová')).toHaveText(String(120 + mondayWords));

  await page.getByRole('button', { name: 'Celkom' }).click();
  await expect(tile('Nadiktované slová')).toHaveText(String(420 + mondayWords));
  await expect(tile('Počet diktovaní')).toHaveText(String(14 + (monday === today ? 0 : 2)));

  await page.evaluate(() => window.codevo.resetStats());
  await expect(tile('Nadiktované slová')).toHaveText('0');
  await expect(page.locator('.week-top span')).toHaveText('spolu 0');
  await expect(stat(join(userDataDir, 'stats.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('copy writes the clipboard and the last transcript is empty after relaunch', async () => {
  await start();
  const card = page.locator('.last');
  await expect(card).toContainText('Zatiaľ nemáte žiadny prepis.');
  await expect(card.getByRole('button', { name: 'Kopírovať' })).toBeDisabled();
  await expect(card).toContainText('Uchováva sa len do zatvorenia aplikácie. Nič sa neukladá na disk.');
  const previousClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());

  await app.evaluate((_electron, text) => {
    (globalThis as unknown as HookGlobal).codevoE2e.lastTranscript.set(text);
  }, TRANSCRIPT);
  await page.reload();
  await expect(card).toContainText(TRANSCRIPT);
  await card.getByRole('button', { name: 'Kopírovať' }).click();

  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(TRANSCRIPT);
  await expect(card.getByRole('button', { name: 'Skopírované' })).toBeVisible();
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), previousClipboard);

  await app.close();
  await start();
  await expect(page.locator('.last')).toContainText('Zatiaľ nemáte žiadny prepis.');
  expect(await page.evaluate(() => window.codevo.getLastTranscript())).toBeNull();
});
