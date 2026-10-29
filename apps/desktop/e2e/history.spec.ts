import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { E2eHooks } from '../src/main/app/e2e-hooks';
import type { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import { createUserDataDir, FAKE_MEDIA_ARGS, launchApp, ONBOARDED, removeUserDataDir } from './launch-app';
import { startLocalGateway, type LocalGateway } from './local-gateway';

type Hooks = { codevoE2e: E2eHooks & { helper: FakeInputHelper }; historyFrames: number };
let app: ElectronApplication;
let page: Page;
let dir: string;
let gateway: LocalGateway | null = null;

async function start(): Promise<void> {
  app = await launchApp(dir, FAKE_MEDIA_ARGS, { fakeHelper: true });
  page = await app.firstWindow();
  await app.evaluate(() => {
    const hooks = globalThis as unknown as Hooks;
    hooks.historyFrames = 0;
    hooks.codevoE2e.capture.onFrame(() => { hooks.historyFrames++; });
  });
}

test.beforeEach(async () => {
  dir = await createUserDataDir({ ...ONBOARDED, hotkey: { kind: 'modifiers', keycodes: [63], label: 'Fn' }, mode: 'hold' });
  await start();
});

test.afterEach(async () => {
  const electronProcess = app.process();
  const electronPid = electronProcess.pid;
  await app.close();
  await gateway?.close();
  gateway = null;
  await test.info().attach('runtime-cleanup', { body: JSON.stringify({ electronPid, exitCode: electronProcess.exitCode, gatewayClosed: true }), contentType: 'application/json' });
  await removeUserDataDir(dir);
});

async function pair(): Promise<void> {
  gateway = await startLocalGateway();
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
  const prior = await app.evaluate(() => {
    const hooks = globalThis as unknown as Hooks;
    return { frames: hooks.historyFrames, pasted: hooks.codevoE2e.helper.pasted.length };
  });
  await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.emitHotkey('down'));
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as Hooks).historyFrames)).toBeGreaterThan(prior.frames + 2);
  await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.emitHotkey('up'));
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.pasted.length)).toBe(prior.pasted + 1);
  await expect.poll(() => page.evaluate(() => window.codevo.getStats().then((days) => days.reduce((sum, day) => sum + day.dictations, 0)))).toBeGreaterThan(0);
}

async function aggregate() {
  await page.getByRole('tab', { name: 'Domov', exact: true }).click();
  const days = await page.evaluate(() => window.codevo.getStats());
  await expect(page.getByText('Počet diktovaní', { exact: true }).locator('..').locator('.v')).toHaveText(String(days.reduce((sum, day) => sum + day.dictations, 0)));
  return { days, raw: await readFile(join(dir, 'stats.json'), 'utf8'), ui: await page.getByRole('group', { name: 'Štatistiky', exact: true }).innerText() };
}

const panel = () => page.getByRole('region', { name: 'História prepisov', exact: true });
const toggle = () => page.getByRole('switch', { name: 'Ukladať históriu prepisov' });
const entries = () => panel().getByRole('list', { name: 'Uložené prepisy' }).getByRole('listitem');

async function screenshot(name: string): Promise<void> {
  await panel().scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath(name) });
}

test('history starts OFF and keyboard consent enables future text collection', async () => {
  await expect(panel()).toContainText('História je vypnutá');
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  await expect(toggle()).toHaveAttribute('aria-checked', 'false');
  await toggle().focus();
  await page.keyboard.press('Space');
  await expect(toggle()).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Počet uchovaných prepisov')).toHaveValue('100');
  await page.getByRole('tab', { name: 'Domov' }).click();
  await expect(panel()).toContainText('Zatiaľ nemáte žiadne uložené prepisy');
});

test('actual dictations persist only after consent and history controls leave all aggregate stats unchanged', async () => {
  test.setTimeout(60_000);
  await pair();
  await dictate();
  expect((await page.evaluate(() => window.codevo.getStats()))[0]?.dictations).toBe(1);
  await expect(panel()).toContainText('História je vypnutá');
  await expect(readFile(join(dir, 'history.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  await toggle().click();
  await expect(toggle()).toHaveAttribute('aria-checked', 'true');
  await dictate();
  await page.getByRole('tab', { name: 'Domov' }).click();
  await expect(entries()).toHaveCount(1);
  await expect(entries().first()).toContainText('prepis zo servera');
  await screenshot('history-recorded.png');
  await app.close();
  await start();
  await expect(entries()).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Posledné diktovanie' })).toContainText('Zatiaľ nemáte žiadny prepis');
  const comparisons: unknown[] = [];
  const statsBeforeSeed = await aggregate();
  await app.close();
  const seeded = Array.from({ length: 12 }, (_, index) => ({ id: randomUUID(), completedAt: Date.now() - index * 1000, text: index === 0 ? `Najnovší <script>plain text</script> ${'dlhýprepis'.repeat(60)}` : `starší prepis ${index}` }));
  await writeFile(join(dir, 'history.json'), JSON.stringify({ version: 1, policy: { enabled: true, limit: 50 }, entries: seeded }));
  await start();
  await expect(entries()).toHaveCount(12);
  await expect(entries().first()).toContainText('<script>plain text</script>');
  expect(await aggregate()).toEqual(statsBeforeSeed);
  const beforePrune = await aggregate();
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  await page.getByLabel('Počet uchovaných prepisov').selectOption('10');
  await expect(page.getByRole('region', { name: 'História prepisov' }).getByRole('status')).toContainText('Nastavenie histórie je uložené');
  const afterPrune = await aggregate();
  expect(afterPrune).toEqual(beforePrune);
  comparisons.push({ action: 'lower-limit', before: beforePrune, after: afterPrune });
  await expect(entries()).toHaveCount(10);
  await expect(entries().last()).toContainText('starší prepis 9');
  await expect.poll(() => page.evaluate(() => window.codevo.isHotkeyArmed())).toBe(true);
  await dictate();
  await expect(entries()).toHaveCount(10);
  await expect(entries().first()).toContainText('prepis zo servera');
  await expect(entries().last()).toContainText('starší prepis 8');
  const view = await page.evaluate(() => window.codevo.getHistory());
  if (view.kind !== 'ready') throw new Error('History unavailable');
  expect(JSON.parse(await readFile(join(dir, 'history.json'), 'utf8'))).toEqual({ version: 1, policy: view.policy, entries: view.entries });
  for (const entry of view.entries) expect(Object.keys(entry).sort()).toEqual(['completedAt', 'id', 'text']);
  expect((await readdir(dir, { recursive: true })).filter((name) => /\.(wav|pcm|mp3|ogg)$/i.test(name))).toEqual([]);
  await test.info().attach('history-schema', { body: await readFile(join(dir, 'history.json')), contentType: 'application/json' });
  for (const width of [980, 760]) {
    await page.setViewportSize({ width, height: 760 });
    await screenshot(`history-home-${width}.png`);
    expect(await panel().evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.getByRole('tab', { name: 'Nastavenia' }).click();
    const group = page.getByRole('region', { name: 'História prepisov' });
    await group.scrollIntoViewIfNeeded();
    expect(await page.locator('.panel').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`history-settings-${width}.png`) });
    await page.getByRole('tab', { name: 'Domov' }).click();
  }
  const beforeDelete = await aggregate();
  const last = await page.evaluate(() => window.codevo.getLastTranscript());
  const clipboard = await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.clipboard);
  await panel().getByRole('button', { name: 'Vymazať prepis 1', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(entries()).toHaveCount(9);
  await expect(panel().getByRole('status')).toHaveText('Prepis je vymazaný.');
  await expect(panel().getByRole('heading')).toBeFocused();
  const afterDelete = await aggregate();
  expect(afterDelete).toEqual(beforeDelete);
  comparisons.push({ action: 'delete-one', before: beforeDelete, after: afterDelete });
  await panel().getByRole('button', { name: 'Vymazať históriu', exact: true }).click();
  await panel().getByRole('button', { name: 'Zrušiť' }).focus();
  await page.keyboard.press('Escape');
  await expect(panel().getByRole('button', { name: 'Vymazať históriu', exact: true })).toBeFocused();
  await expect(entries()).toHaveCount(9);
  const beforeClear = await aggregate();
  await panel().getByRole('button', { name: 'Vymazať históriu', exact: true }).click();
  await expect(panel()).toContainText('História ostane zapnutá');
  await panel().getByRole('button', { name: 'Áno, vymazať históriu' }).click();
  await expect(panel()).toContainText('Zatiaľ nemáte žiadne uložené prepisy');
  const afterClear = await aggregate();
  expect(afterClear).toEqual(beforeClear);
  comparisons.push({ action: 'clear', before: beforeClear, after: afterClear });
  expect(await page.evaluate(() => window.codevo.getHistory())).toMatchObject({ policy: { enabled: true, limit: 10 }, entries: [] });
  expect(await page.evaluate(() => window.codevo.getLastTranscript())).toBe(last);
  expect(await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.clipboard)).toBe(clipboard);
  await dictate();
  await expect(entries()).toHaveCount(1);
  const beforeDisable = await aggregate();
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  await toggle().focus();
  await page.keyboard.press('Space');
  await expect(toggle()).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Vypnúť históriu a vymazať všetky uložené prepisy?', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Zrušiť', exact: true }).click();
  await expect(toggle()).toBeFocused();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Áno, vypnúť a vymazať' }).click();
  await expect(toggle()).toHaveAttribute('aria-checked', 'false');
  await expect(toggle()).toBeFocused();
  const afterDisable = await aggregate();
  expect(afterDisable).toEqual(beforeDisable);
  comparisons.push({ action: 'disable', before: beforeDisable, after: afterDisable });
  await test.info().attach('statistics-around-deletions', { body: JSON.stringify(comparisons, null, 2), contentType: 'application/json' });
  await expect(panel()).toContainText('História je vypnutá');
  expect(await page.evaluate(() => window.codevo.getHistory())).toMatchObject({ policy: { enabled: false, limit: 10 }, entries: [] });
  await screenshot('history-disabled.png');
  await app.close();
  await start();
  await expect(panel()).toContainText('História je vypnutá');
  await expect(page.getByRole('region', { name: 'Posledné diktovanie' })).toContainText('Zatiaľ nemáte žiadny prepis');
});

test('real background persistence failure is visible while insertion and stats succeed', async () => {
  await pair();
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  await toggle().click();
  await expect(toggle()).toHaveAttribute('aria-checked', 'true');
  await rm(join(dir, 'history.json'));
  await mkdir(join(dir, 'history.json'));
  await dictate();
  await page.getByRole('tab', { name: 'Domov' }).click();
  await expect(panel().getByRole('alert')).toContainText('Zmenu histórie sa nepodarilo uložiť');
  expect(await page.evaluate(() => window.codevo.getHistory())).toMatchObject({ entries: [], writeError: true });
  expect((await page.evaluate(() => window.codevo.getStats()))[0]?.dictations).toBe(1);
  await expect(page.getByRole('region', { name: 'Posledné diktovanie' })).toContainText('prepis zo servera');
  await expect(readFile(join(dir, 'history.json.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
  await screenshot('history-write-error.png');
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  await expect(page.getByRole('region', { name: 'História prepisov' }).getByRole('alert')).toContainText('Zmenu histórie sa nepodarilo uložiť');
});

test('malformed history is unavailable and an untrusted renderer cannot read or change history', async () => {
  const preload = fileURLToPath(new URL('../out/preload/index.cjs', import.meta.url));
  const result = await app.evaluate(async ({ BrowserWindow }, preloadPath) => {
    const alien = new BrowserWindow({ show: false, webPreferences: { preload: preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
      await alien.loadURL('data:text/html,<title>Untrusted fixture</title>');
      return await alien.webContents.executeJavaScript("Promise.all([window.codevo.getHistory(), window.codevo.configureHistory({enabled:true,limit:10}), window.codevo.clearHistory()].map(p => p.then(() => 'accepted', e => String(e))))") as unknown;
    } finally {
      alien.destroy();
    }
  }, preload);
  expect(result).toEqual([expect.stringContaining('Untrusted IPC sender'), expect.stringContaining('Untrusted IPC sender'), expect.stringContaining('Untrusted IPC sender')]);
  expect(await page.evaluate(() => window.codevo.getHistory())).toMatchObject({ policy: { enabled: false, limit: 100 }, entries: [] });
  await app.close();
  await writeFile(join(dir, 'history.json'), '{malformed');
  await writeFile(join(dir, 'history.json.tmp'), 'stale history text');
  await start();
  await expect(panel().getByRole('alert')).toContainText('História nie je dostupná');
  await expect(readFile(join(dir, 'history.json.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
  await screenshot('history-unavailable.png');
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  await expect(page.getByRole('region', { name: 'História prepisov' }).getByRole('alert')).toContainText('História nie je dostupná');
  await expect(toggle()).toHaveCount(0);
});
