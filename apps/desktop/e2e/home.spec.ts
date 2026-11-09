import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { E2eHooks } from '../src/main/app/e2e-hooks';
import { addDays, localDate, weekStart } from '../src/shared/calendar-date';
import type { AppStatus } from '../src/shared/app-status';
import type { DayStats } from '../src/shared/stats';
import { mainWindow } from './app-windows';
import { createUserDataDir, launchApp, ONBOARDED, removeUserDataDir } from './launch-app';

type HookGlobal = { codevoE2e: E2eHooks };

const RIGHT_CONTROL = { kind: 'modifiers', keycodes: [62], label: 'Pravý ⌃ Control' } as const;
const READY: AppStatus = { hotkeyLabel: RIGHT_CONTROL.label, mode: 'hold', modelReady: true, pairingNeeded: false, serverRepairNeeded: false, permissionsOk: true, paused: false };
const TRANSCRIPT = 'Ahoj Peter, pozrel som si ten pull request.';

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

async function start(): Promise<void> {
  app = await launchApp(userDataDir);
  page = await mainWindow(app);
}

test.beforeEach(async () => {
  userDataDir = await createUserDataDir(ONBOARDED);
});

test.afterEach(async () => {
  await app.close();
  await removeUserDataDir(userDataDir);
});

function banner(): Locator {
  return page.locator('.banner');
}

function period(label: string): Locator {
  return page.getByRole('group', { name: 'Obdobie štatistík' }).getByRole('button', { name: label, exact: true });
}

function tile(label: string): Locator {
  return page.locator('.kpis > div', { hasText: label }).locator('.v');
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
  await expect(banner()).toContainText('Lokálny model nie je stiahnutý.');
  await expect(banner().getByRole('button')).toHaveText(['Spárovať server', 'Stiahnuť model']);
  await expect(banner().getByRole('button', { name: 'Stiahnuť model' })).toHaveClass(/primary/);
  await expect(page.getByRole('region', { name: 'Od klávesu po vložený text' }).locator('.node', { hasText: 'Prepis' })).toHaveClass(/\berr\b/);
  await banner().getByRole('button', { name: 'Stiahnuť model' }).click();
  await expect(page.getByRole('tab', { name: 'Nastavenia' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 2, name: 'Lokálny model', exact: true })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Lokálny model' })).toBeInViewport();
  await page.getByRole('tab', { name: 'Domov' }).click();

  await expect(async () => {
    await pushStatus(READY);
    await expect(banner().locator('.msg')).toHaveText('Všetko je pripravené. Podržte Pravý ⌃ Control v ľubovoľnej aplikácii a hovorte.', { timeout: 500 });
  }).toPass();
  await expect(banner().locator('kbd')).toHaveText(RIGHT_CONTROL.label);

  for (const mode of ['toggle', 'smart'] as const) {
    await expect(async () => {
      await pushStatus({ ...READY, mode });
      await expect(banner().locator('.msg')).toHaveText('Všetko je pripravené. Stlačte Pravý ⌃ Control v ľubovoľnej aplikácii a hovorte.', { timeout: 500 });
    }).toPass();
  }
});

test('the signal path shows each step and opens its settings section', async () => {
  await start();
  const path = page.getByRole('region', { name: 'Od klávesu po vložený text' });
  const hotkey = path.locator('.node', { hasText: 'Skratka' });

  await expect(path.locator('.node')).toHaveCount(5);
  await expect(hotkey).toHaveClass(/\berr\b/);
  await expect(hotkey).toContainText('Nenastavená');
  await expect(path.locator('.node', { hasText: 'AI úprava' })).toContainText('Vypnutá');
  await expect(page.getByRole('tab', { name: 'Domov', exact: true })).toHaveAttribute('aria-describedby', 'rail-attention');
  await expect(page.locator('.sbar')).toContainText('Diktovanie nefunguje');

  await hotkey.click();

  await expect(page.getByRole('tab', { name: 'Nastavenia' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 2, name: 'Diktovanie', exact: true })).toBeFocused();
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

  await expect(period('Dnes')).toHaveAttribute('aria-pressed', 'true');
  await expect(tile('Nadiktované slová')).toHaveText('120');
  await expect(tile('Počet diktovaní')).toHaveText('4');
  await expect(tile('Čas diktovania')).toHaveText('1 min');
  await expect(tile('Priemerná rýchlosť')).toHaveText('120');
  await expect(tile('Ušetrený čas')).toHaveText('2 min');
  await expect(page.locator('.chart-top .ttl span')).toHaveText(`${120 + mondayWords} spolu`);
  await expect(page.getByText('Štatistiky sú len súčty čísel na tomto Macu, bez textu.')).toBeVisible();

  await period('Tento týždeň').click();
  await expect(period('Tento týždeň')).toHaveAttribute('aria-pressed', 'true');
  await expect(period('Dnes')).toHaveAttribute('aria-pressed', 'false');
  await expect(tile('Nadiktované slová')).toHaveText(String(120 + mondayWords));

  await period('Celkom').click();
  await expect(tile('Nadiktované slová')).toHaveText(String(420 + mondayWords));
  await expect(tile('Počet diktovaní')).toHaveText(String(14 + (monday === today ? 0 : 2)));

  await page.evaluate(() => window.codevo.resetStats());
  await expect(tile('Nadiktované slová')).toHaveText('0');
  await expect(page.locator('.chart-top .ttl span')).toHaveText('0 spolu');
  await expect(stat(join(userDataDir, 'stats.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

function setLastTranscript(text: string): Promise<void> {
  return app.evaluate((_electron, value) => {
    (globalThis as unknown as HookGlobal).codevoE2e.lastTranscript.set(value);
  }, text);
}

test('copy writes the clipboard and the last transcript is empty after relaunch', async () => {
  await start();
  const card = page.getByRole('region', { name: 'Posledné diktovanie', exact: true });
  await expect(card).toContainText('Zatiaľ nemáte žiadny prepis.');
  await expect(card.getByRole('button', { name: 'Kopírovať' })).toBeDisabled();
  await expect(card).toContainText('Táto karta ostáva v pamäti do zatvorenia aplikácie. Voliteľnú históriu na disku spravujete v Nastaveniach.');
  const previousClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());

  try {
    await setLastTranscript(TRANSCRIPT);
    await expect(card).toContainText(TRANSCRIPT);
    await card.getByRole('button', { name: 'Kopírovať' }).click();

    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(TRANSCRIPT);
    await expect(card.getByRole('button', { name: 'Skopírované' })).toBeVisible();
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), previousClipboard);
  }

  await app.close();
  await start();
  await expect(page.getByRole('region', { name: 'Posledné diktovanie', exact: true })).toContainText('Zatiaľ nemáte žiadny prepis.');
  expect(await page.evaluate(() => window.codevo.getLastTranscript())).toBeNull();
});

test('copy replays the exact safe trailing space after transcript preferences change', async () => {
  await start();
  const previousClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await app.evaluate(() => {
      (globalThis as unknown as HookGlobal).codevoE2e.lastTranscript.set(' Žilina\r\n\u0000 ', { appendTrailingSpace: true });
    });
    await page.evaluate(() => window.codevo.updateSettings({ customWords: ['Other'], appendTrailingSpace: false }));
    await expect.poll(() => page.evaluate(() => window.codevo.getLastTranscript())).toBe('Žilina ');
    await page.getByRole('region', { name: 'Posledné diktovanie', exact: true }).getByRole('button', { name: 'Kopírovať', exact: true }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Žilina ');
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), previousClipboard);
  }
});

test('the last transcript card updates even when the statistics cannot be saved', async () => {
  await mkdir(join(userDataDir, 'stats.json'));
  await start();
  await expect(page.getByRole('region', { name: 'Posledné diktovanie', exact: true })).toContainText('Zatiaľ nemáte žiadny prepis.');

  await setLastTranscript(TRANSCRIPT);

  await expect(page.getByRole('region', { name: 'Posledné diktovanie', exact: true })).toContainText(TRANSCRIPT);
});

test('shows a fallback and logs when the statistics cannot be loaded', async () => {
  await start();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('stats:get');
    ipcMain.handle('stats:get', () => Promise.reject(new Error('stats unavailable')));
  });

  await page.reload();

  await expect(page.getByRole('alert')).toHaveText('Štatistiky sa nepodarilo načítať.');
  await expect(tile('Nadiktované slová')).toHaveText('0');
  await expect.poll(() => errors.some((text) => text.includes('stats unavailable'))).toBe(true);
});

test('Dnes moves to the new day at local midnight while the window stays open', async () => {
  const days: DayStats[] = [{ date: '2026-10-25', words: 120, dictations: 4, seconds: 60 }];
  await writeFile(join(userDataDir, 'stats.json'), JSON.stringify({ version: 1, days }));
  await start();
  await page.clock.install({ time: new Date('2026-10-25T23:59:50') });
  await page.reload();
  await expect(tile('Nadiktované slová')).toHaveText('120');
  await expect(page.locator('.wc-col.today')).toHaveAttribute('aria-label', 'dnes, 25. 10.: 120 slov');
  await expect(page.locator('.wc-x span').nth(5)).toHaveText('so');
  await expect(page.locator('.hm .c.today')).toHaveAttribute('aria-label', 'Dnes: 120 slov');
  await page.locator('.hm .c.today').focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.hm .c:focus')).toHaveAttribute('aria-label', 'sobota 24. 10.: bez diktovania');

  await page.clock.runFor(20_000);

  await expect(tile('Nadiktované slová')).toHaveText('0');
  await expect(page.locator('.wc-col.today')).toHaveAttribute('aria-label', 'dnes, 26. 10.: 0 slov');
  await expect(page.locator('.wc-x span').nth(5)).toHaveText('ne');
  await expect(page.locator('.st-streak .big')).toHaveText('1deň po sebe');
});
