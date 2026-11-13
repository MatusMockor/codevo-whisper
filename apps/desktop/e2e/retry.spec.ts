import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { E2eHooks } from '../src/main/app/e2e-hooks';
import type { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import { mainWindow } from './app-windows';
import { createUserDataDir, FAKE_MEDIA_ARGS, launchApp, ONBOARDED, removeUserDataDir } from './launch-app';
import { startLocalGateway, type LocalGateway } from './local-gateway';

type Hooks = { codevoE2e: E2eHooks & { helper: FakeInputHelper }; retryFrames: number };

const OVERLAY_PAGE = '/overlay/overlay.html';

let app: ElectronApplication;
let page: Page;
let dir: string;
let gateway: LocalGateway;
let failFlag: string;

test.beforeEach(async () => {
  dir = await createUserDataDir({ ...ONBOARDED, hotkey: { kind: 'modifiers', keycodes: [63], label: 'Fn' }, mode: 'hold' });
  failFlag = join(dir, 'stt-fails');
  gateway = await startLocalGateway({ failWhileFile: failFlag });
  app = await launchApp(dir, FAKE_MEDIA_ARGS, { fakeHelper: true });
  page = await mainWindow(app);
  await app.evaluate(() => {
    const hooks = globalThis as unknown as Hooks;
    hooks.retryFrames = 0;
    hooks.codevoE2e.capture.onFrame(() => { hooks.retryFrames++; });
  });
  const pairing = await gateway.openPairingWindow();
  await page.evaluate((token) => window.codevo.pairServer(token), pairing.token);
  await pairing.admin.next();
  pairing.admin.send({ decision: 'approve' });
  await pairing.admin.next();
  pairing.admin.close();
  await expect.poll(() => page.evaluate(() => window.codevo.getServer().then((view) => view.server?.status.kind))).toBe('online');
  await page.evaluate(() => window.codevo.updateSettings({ engineOrder: ['server'] }));
  await expect.poll(() => page.evaluate(() => window.codevo.isHotkeyArmed())).toBe(true);
});

test.afterEach(async () => {
  await app.close();
  await gateway.close();
  await removeUserDataDir(dir);
});

function pasted(): Promise<string[]> {
  return app.evaluate(() => [...(globalThis as unknown as Hooks).codevoE2e.helper.pasted]);
}

async function overlayPage(): Promise<Page> {
  await expect.poll(() => app.windows().some((window) => window.url().endsWith(OVERLAY_PAGE))).toBe(true);
  return app.windows().find((window) => window.url().endsWith(OVERLAY_PAGE)) as Page;
}

test('a failed server transcription is retried from the overlay without recording again', async () => {
  await writeFile(failFlag, '');
  await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.emitHotkey('down'));
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as Hooks).retryFrames)).toBeGreaterThan(20);
  await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.emitHotkey('up'));

  const overlay = await overlayPage();
  const alert = overlay.getByRole('alert');
  await expect(alert).toContainText('Prepis na serveri teraz nefunguje');
  const retry = alert.getByRole('button', { name: 'Skúsiť znova' });
  await expect(retry).toBeVisible();
  await overlay.screenshot({ path: test.info().outputPath('retry-card.png') });
  const framesAfterFailure = await app.evaluate(() => (globalThis as unknown as Hooks).retryFrames);
  expect(await pasted()).toEqual([]);

  await rm(failFlag);
  await retry.click();

  await expect.poll(pasted).toEqual(['prepis zo servera']);
  const requests = gateway.sttRequests();
  expect(requests.length).toBeGreaterThanOrEqual(2);
  expect(requests.at(-1)?.bytes).toBe(requests[0]?.bytes);
  expect(await app.evaluate(() => (globalThis as unknown as Hooks).retryFrames)).toBe(framesAfterFailure);
  await expect.poll(() => page.evaluate(() => window.codevo.getStats().then((days) => days.reduce((sum, day) => sum + day.dictations, 0)))).toBe(1);
  await expect(overlay.getByRole('button', { name: 'Skúsiť znova' })).toHaveCount(0);
});
