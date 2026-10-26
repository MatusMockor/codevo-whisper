import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { E2eHooks } from '../src/main/app/e2e-hooks';
import type { OverlayState } from '../src/shared/overlay-contract';
import { createUserDataDir, launchApp, ONBOARDED, removeUserDataDir } from './launch-app';

type HookGlobal = { codevoE2e: E2eHooks };

type PanelFlags = { focusable: boolean; visible: boolean; alwaysOnTop: boolean; allWorkspaces: boolean; focused: boolean; mainFocused: boolean };

const OVERLAY_PAGE = '/overlay/overlay.html';

let app: ElectronApplication;
let main: Page;
let userDataDir: string;

test.beforeEach(async () => {
  userDataDir = await createUserDataDir(ONBOARDED);
  app = await launchApp(userDataDir);
  main = await app.firstWindow();
});

test.afterEach(async () => {
  await app.close();
  await removeUserDataDir(userDataDir);
});

function inject(state: OverlayState): Promise<void> {
  return app.evaluate((_electron, injected) => {
    (globalThis as unknown as HookGlobal).codevoE2e.overlay.show(injected);
  }, state);
}

async function overlayPage(): Promise<Page> {
  await expect.poll(() => app.windows().some((page) => page.url().endsWith(OVERLAY_PAGE))).toBe(true);
  return app.windows().find((page) => page.url().endsWith(OVERLAY_PAGE)) as Page;
}

function panelFlags(): Promise<PanelFlags> {
  return app.evaluate(({ BrowserWindow }, pagePath) => {
    const windows = BrowserWindow.getAllWindows();
    const panel = windows.find((window) => window.webContents.getURL().endsWith(pagePath));
    const mainWindow = windows.find((window) => window.getTitle() === 'Codevo Whisper');
    return {
      focusable: panel?.isFocusable() ?? true,
      visible: panel?.isVisible() ?? false,
      alwaysOnTop: panel?.isAlwaysOnTop() ?? false,
      allWorkspaces: panel?.isVisibleOnAllWorkspaces() ?? false,
      focused: panel?.isFocused() ?? true,
      mainFocused: mainWindow?.isFocused() ?? false,
    };
  }, OVERLAY_PAGE);
}

test('overlay window is not focusable and shows the recording state from an injected state', async () => {
  const mainFocusedBefore = (await panelFlags()).mainFocused;
  await inject({ kind: 'recording', elapsedMs: 4200, level: 0.5, language: 'SK' });
  const overlay = await overlayPage();

  const pill = overlay.getByRole('status', { name: 'Nahrávam' });
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('0:04');
  await expect(pill).toContainText('SK');
  await expect.poll(panelFlags).toMatchObject({ focusable: false, visible: true, alwaysOnTop: true, allWorkspaces: true, focused: false });
  await inject({ kind: 'processing' });
  await expect(overlay.getByText('Spracúvam')).toBeVisible();
  expect(await panelFlags()).toMatchObject({ focusable: false, focused: false, mainFocused: mainFocusedBefore });

  await inject({ kind: 'hidden' });
  await expect.poll(async () => (await panelFlags()).visible).toBe(false);
});

test('Živý text shows confirmed words solid and tentative words lighter, grows upward and never takes focus', async () => {
  const mainFocusedBefore = (await panelFlags()).mainFocused;
  const recording = { kind: 'recording', elapsedMs: 4200, level: 0.6, language: 'SK' } as const;
  await inject({ ...recording, live: { confirmed: '', tentative: '' } });
  const overlay = await overlayPage();
  const card = overlay.getByRole('status', { name: 'Nahrávam' });
  await expect(card).toContainText('0:04');
  await expect(overlay.locator('.ov-text')).toHaveCount(0);
  const empty = await card.boundingBox();

  await inject({ ...recording, live: { confirmed: 'ahoj Peter pozrel som si ten pull request vyzerá to', tentative: 'dobre len by' } });

  const confirmed = overlay.locator('.ov-text .w:not(.t)');
  const tentative = overlay.locator('.ov-text .w.t');
  await expect(confirmed).toHaveText('ahoj Peter pozrel som si ten pull request vyzerá to');
  await expect(tentative).toHaveText('dobre len by');
  const color = (locator: typeof confirmed) => locator.evaluate((element) => getComputedStyle(element).color);
  expect(await color(tentative)).not.toBe(await color(confirmed));
  const oneLine = await card.boundingBox();
  const text = await overlay.locator('.ov-text').boundingBox();
  const bar = await card.locator('.ov-bar').boundingBox();
  expect((text?.y ?? 0) + (text?.height ?? 0)).toBeLessThanOrEqual((bar?.y ?? 0) + 1);
  expect(Math.abs((oneLine?.y ?? 0) + (oneLine?.height ?? 0) - ((empty?.y ?? 0) + (empty?.height ?? 0)))).toBeLessThanOrEqual(1);
  expect(oneLine?.y ?? 0).toBeLessThan(empty?.y ?? 0);

  const long = Array.from({ length: 40 }, (_value, index) => `slovo${index}`).join(' ');
  await inject({ ...recording, live: { confirmed: long, tentative: 'posledné slová' } });
  await expect(tentative).toHaveText('posledné slová');
  const full = await card.boundingBox();
  expect(full?.y ?? 0).toBeLessThan(oneLine?.y ?? 0);
  expect(full?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((await overlay.locator('.ov-text').boundingBox())?.height ?? Infinity).toBeLessThanOrEqual(82);
  await expect(overlay.locator('.ov-notice')).toHaveCount(0);

  await inject({ kind: 'processing', live: { confirmed: 'ahoj Peter, pozrel som si ten pull request.', tentative: '' } });
  await expect(overlay.getByText('Spracúvam')).toBeVisible();
  await expect(confirmed).toHaveText('ahoj Peter, pozrel som si ten pull request.');
  await expect(tentative).toHaveCount(0);

  expect(await panelFlags()).toMatchObject({ focusable: false, visible: true, focused: false, mainFocused: mainFocusedBefore });
});

test('Živý text keeps the fallback notice inside the panel', async () => {
  const long = Array.from({ length: 40 }, (_value, index) => `slovo${index}`).join(' ');
  await inject({ kind: 'recording', elapsedMs: 1000, level: 0.2, language: 'SK', fallbackDevice: 'AirPods Pro', live: { confirmed: long, tentative: 'a ďalej' } });
  const overlay = await overlayPage();

  const notice = overlay.getByText('Mikrofón AirPods Pro nie je pripojený, používam predvolený');
  await expect(notice).toBeVisible();
  expect((await notice.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);
});

test('hiding clears the rendered state so the next show never flashes the previous result', async () => {
  await inject({ kind: 'inserted', appName: 'Notes' });
  const overlay = await overlayPage();
  await expect(overlay.getByRole('status')).toHaveText('VloženéNotes');

  await inject({ kind: 'hidden' });

  await expect(overlay.locator('.stage > *')).toHaveCount(0);
  await expect.poll(async () => (await panelFlags()).visible).toBe(false);
});

test('overlay shows the fallback notice, the processing and the result states', async () => {
  await inject({ kind: 'recording', elapsedMs: 65_000, level: 0.1, language: 'EN', fallbackDevice: 'AirPods Pro' });
  const overlay = await overlayPage();
  await expect(overlay.getByText('Mikrofón AirPods Pro nie je pripojený, používam predvolený')).toBeVisible();
  await expect(overlay.getByRole('status', { name: 'Nahrávam' })).toContainText('1:05');

  await inject({ kind: 'processing', notice: 'limit-reached' });
  await expect(overlay.getByText('Spracúvam')).toBeVisible();
  await expect(overlay.getByText('dosiahnutý limit 10 minút')).toBeVisible();

  await inject({ kind: 'inserted', appName: 'Notes' });
  await expect(overlay.getByRole('status')).toHaveText('VloženéNotes');

  await inject({ kind: 'copied' });
  await expect(overlay.getByText('Skopírované - vlož cez ⌘V')).toBeVisible();
});

test('overlay error and blocked states offer their actions', async () => {
  await inject({ kind: 'error', message: 'Nemáte stiahnutý model', action: 'open-settings' });
  const overlay = await overlayPage();
  const alert = overlay.getByRole('alert');
  await expect(alert).toContainText('Nemáte stiahnutý model');
  await expect(alert.getByRole('button', { name: 'Otvoriť nastavenia' })).toBeVisible();

  await inject({ kind: 'blocked', reason: 'focus' });
  await expect(overlay.getByRole('alert')).toContainText('Okno sa zmenilo, text nebol vložený');
  await expect(overlay.getByRole('button', { name: 'Kopírovať' })).toBeVisible();

  await inject({ kind: 'error', message: 'Prepis sa nepodaril' });
  await expect(overlay.getByRole('alert')).toContainText('Prepis sa nepodaril');
  await expect(overlay.getByRole('button')).toHaveCount(0);
});

test('the overlay settings action opens the settings page', async () => {
  await inject({ kind: 'error', message: 'Nemáte stiahnutý model', action: 'open-settings' });
  const overlay = await overlayPage();
  const button = overlay.getByRole('button', { name: 'Otvoriť nastavenia' });
  const style = (property: 'cursor' | 'backgroundColor') => button.evaluate((element, name) => getComputedStyle(element)[name], property);
  await expect(button).toBeVisible();
  expect(await style('cursor')).toBe('pointer');
  expect(await overlay.locator('.ov-title').evaluate((element) => getComputedStyle(element).cursor)).toBe('default');
  const resting = await style('backgroundColor');
  await button.hover();
  await expect.poll(() => style('backgroundColor')).not.toBe(resting);

  await button.click();

  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Nastavenia');
  await expect(main.getByRole('tab', { name: 'Nastavenia' })).toHaveAttribute('aria-selected', 'true');
});
