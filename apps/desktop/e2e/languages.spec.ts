import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { E2eHooks } from '../src/main/app/e2e-hooks';
import type { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import type { LanguageSelection } from '../src/shared/dictation-languages';
import { mainWindow } from './app-windows';
import { createUserDataDir, FAKE_MEDIA_ARGS, launchApp, ONBOARDED, removeUserDataDir } from './launch-app';
import { startLocalGateway, type LocalGateway, type LocalGatewayOptions } from './local-gateway';

type Hooks = { codevoE2e: E2eHooks & { helper: FakeInputHelper }; languageFrames: number };

const OVERLAY_PAGE = '/overlay/overlay.html';
const SLOVAK_AND_CZECH: LanguageSelection = { mode: 'selected', selected: ['sk', 'cs'] };

let app: ElectronApplication;
let page: Page;
let dir: string;
let gateway: LocalGateway | null = null;

test.beforeEach(async () => {
  dir = await createUserDataDir({ ...ONBOARDED, hotkey: { kind: 'modifiers', keycodes: [63], label: 'Fn' }, mode: 'hold', languages: SLOVAK_AND_CZECH });
  app = await launchApp(dir, FAKE_MEDIA_ARGS, { fakeHelper: true });
  page = await mainWindow(app);
  await app.evaluate(() => {
    const hooks = globalThis as unknown as Hooks;
    hooks.languageFrames = 0;
    hooks.codevoE2e.capture.onFrame(() => {
      hooks.languageFrames++;
    });
  });
});

test.afterEach(async () => {
  await app.close();
  await gateway?.close();
  gateway = null;
  await removeUserDataDir(dir);
});

async function pair(options: LocalGatewayOptions): Promise<void> {
  gateway = await startLocalGateway(options);
  const pairing = await gateway.openPairingWindow();
  await page.evaluate((token) => window.codevo.pairServer(token), pairing.token);
  await pairing.admin.next();
  pairing.admin.send({ decision: 'approve' });
  await pairing.admin.next();
  pairing.admin.close();
  await expect.poll(() => page.evaluate(() => window.codevo.getServer().then((view) => view.server?.status.kind))).toBe('online');
  await page.evaluate(() => window.codevo.updateSettings({ engineOrder: ['server'] }));
  await expect.poll(() => page.evaluate(() => window.codevo.isHotkeyArmed())).toBe(true);
}

async function dictate(): Promise<void> {
  const frames = await app.evaluate(() => (globalThis as unknown as Hooks).languageFrames);
  await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.emitHotkey('down'));
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as Hooks).languageFrames)).toBeGreaterThan(frames + 2);
  await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.emitHotkey('up'));
}

async function refusedDictation(message: string): Promise<void> {
  await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.emitHotkey('down'));
  await expect((await overlay()).getByRole('alert')).toContainText(message);
  await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.emitHotkey('up'));
}

function pasted(): Promise<string[]> {
  return app.evaluate(() => [...(globalThis as unknown as Hooks).codevoE2e.helper.pasted]);
}

async function overlay(): Promise<Page> {
  await expect.poll(() => app.windows().some((window) => window.url().endsWith(OVERLAY_PAGE))).toBe(true);
  return app.windows().find((window) => window.url().endsWith(OVERLAY_PAGE)) as Page;
}

async function languagesRow(): Promise<Locator> {
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nastavenia');
  return page.locator('.srow', { has: page.locator('b', { hasText: 'Jazyky diktovania' }) });
}

test('dictates in the selected languages on a server with the language models and sends them in order', async () => {
  await pair({ languageModels: true });

  await dictate();

  await expect.poll(pasted).toEqual(['prepis v jazykoch sk cs']);
  await expect(await languagesRow()).toContainText('Server podporuje výber jazykov.');
});

test('an outdated server shows the overlay error and the update note, and Automaticky still dictates', async () => {
  await pair({ serverVersion: '0.2.7', languageModels: true });

  await refusedDictation('Server nepozná výber jazykov. Aktualizujte ho alebo zapnite Automaticky.');

  expect(await pasted()).toEqual([]);
  const row = await languagesRow();
  await expect(row).toContainText('Server je zastaraný (verzia 0.2.7). Výber jazykov funguje od verzie 0.3.0, aktualizujte server.');

  await row.getByRole('group', { name: 'Jazyky diktovania' }).getByRole('button', { name: 'Automaticky' }).click();
  await expect.poll(() => page.evaluate(() => window.codevo.getSettings().then((settings) => settings.languages.mode))).toBe('auto');
  await dictate();

  await expect.poll(pasted).toEqual(['prepis zo servera']);
});

test('a server without the language models shows the overlay error and the provisioning note', async () => {
  await pair({});

  await refusedDictation('Na serveri chýbajú modely pre zvolené jazyky.');

  expect(await pasted()).toEqual([]);
  await expect(await languagesRow()).toContainText('Na serveri chýbajú modely pre výber jazykov. Spustite na serveri stt-provision.');
});

async function useCustomWords(): Promise<void> {
  const customWords = [{ word: 'Prepis zo', aliases: [] }, { word: 'Kumiba MCP', aliases: ['servera'] }];
  await page.evaluate((words) => window.codevo.updateSettings({ languages: { mode: 'auto', selected: ['sk', 'cs'] }, customWords: words }), customWords);
}

test('a current server gets the custom words as vocabulary and the transcript gets aliases and multi-word terms corrected', async () => {
  await pair({});
  await useCustomWords();

  await dictate();

  await expect.poll(pasted).toEqual(['Prepis zo Kumiba MCP']);
  expect(gateway?.sttRequests().map((request) => request.vocabulary)).toEqual([['Prepis zo', 'Kumiba MCP']]);
});

test('an older server gets no vocabulary and the transcript is still corrected', async () => {
  await pair({ serverVersion: '0.3.0' });
  await useCustomWords();

  await dictate();

  await expect.poll(pasted).toEqual(['Prepis zo Kumiba MCP']);
  expect(gateway?.sttRequests().map((request) => request.vocabulary)).toEqual([undefined]);
});
