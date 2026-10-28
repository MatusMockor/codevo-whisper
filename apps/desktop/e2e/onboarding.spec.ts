import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { HotkeyRecordResult } from '../src/shared/hotkey-record';
import type { Settings } from '../src/shared/settings';
import { createUserDataDir, FAKE_MEDIA_ARGS, launchApp, removeUserDataDir } from './launch-app';
import { startLocalGateway, type LocalGateway } from './local-gateway';

type PairedEvent = { event: 'paired'; deviceId: string };

type FakeHelperGlobal = {
  codevoE2e: {
    helper: { recordedHotkey: HotkeyRecordResult; requestedPermissions: string[]; permissionState: { listen: boolean; post: boolean; accessibility: boolean } };
    shell: { opened: string[]; revealed: string[] };
  };
};

const INPUT_MONITORING_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent';
const MANUAL_ADD_HINT = 'Ak tam Codevo Whisper nie je, kliknite v zozname na + a vyberte ju, alebo ju tam presuňte z Findera.';

const DEFAULT_MODEL_NAME = process.arch === 'arm64' ? 'Parakeet Ultra' : 'Parakeet Ultra (malý)';

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let gateway: LocalGateway | null = null;

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
  await gateway?.close();
  gateway = null;
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

function engines() {
  return page.getByRole('radiogroup', { name: 'Kde bude bežať prepis' });
}

function modelList() {
  return page.getByRole('list', { name: 'Modely na prepis' });
}

async function savedSettings(): Promise<Settings> {
  return JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as Settings;
}

async function expectNoModelDownload(): Promise<void> {
  await expect(stat(join(userDataDir, 'models'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(page.getByRole('progressbar')).toHaveCount(0);
}

async function recordHotkeyAndOpenEngineStep(): Promise<void> {
  await next();
  await next();
  await expect(heading()).toHaveText('Klávesová skratka');
  await app.evaluate(() => {
    (globalThis as unknown as FakeHelperGlobal).codevoE2e.helper.recordedHotkey = { kind: 'modifiers', keycodes: [62], label: 'Pravý ⌃ Control' };
  });
  await page.locator('.hk').click();
  await expect(page.locator('.hk')).toContainText('Pravý ⌃ Control');
  await next();
  await expect(heading()).toHaveText('Kde bude bežať prepis');
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

test('the engine step offers three choices, preselects none and moves on without downloading anything', async () => {
  await recordHotkeyAndOpenEngineStep();
  await expect(page.locator('.ob-lead')).toContainText('na vlastnom serveri');
  await expect(engines().getByRole('radio')).toHaveCount(3);
  await expect(engines().getByRole('radio', { name: /^Na tomto Macu/ })).not.toBeChecked();
  await expect(engines().getByRole('radio', { name: /^Na vlastnom serveri/ })).not.toBeChecked();
  await expect(engines().getByRole('radio', { name: /^Nastavím neskôr/ })).not.toBeChecked();
  await expect(modelList()).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Párovací token' })).toHaveCount(0);

  await engines().getByRole('radio', { name: /^Nastavím neskôr/ }).check();
  await expect(page.getByText('spárujete server na stránke Server')).toBeVisible();
  await next();
  await expect(heading()).toHaveText('Vyskúšajte to');
  await expect(page.getByText('Prepis zatiaľ nie je nastavený.')).toBeVisible();
  await expect(page.getByText('Model sa ešte sťahuje')).toHaveCount(0);
  await page.getByRole('button', { name: 'Dokončiť' }).click();

  await expect(page.getByRole('tablist', { name: 'Sekcie aplikácie' })).toBeVisible();
  await expect.poll(async () => (await savedSettings()).onboardingDone).toBe(true);
  expect((await savedSettings()).engineOrder).toEqual(['local']);
  await expectNoModelDownload();
});

test('switching the engine quickly back to this Mac saves the local order', async () => {
  await recordHotkeyAndOpenEngineStep();
  await page.evaluate(() => {
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="engine-choice"]')];
    radios[1]?.click();
    radios[0]?.click();
  });
  await page.evaluate(() => window.codevo.updateSettings({ mode: 'hold' }));
  await expect(engines().getByRole('radio', { name: /^Na tomto Macu/ })).toBeChecked();
  expect((await savedSettings()).engineOrder).toEqual(['local']);
  await expect(modelList()).toBeVisible();
  await expectNoModelDownload();
});

test('choosing this Mac drops a server fallback so audio never leaves the Mac', async () => {
  await app.close();
  await removeUserDataDir(userDataDir);
  userDataDir = await createUserDataDir({ engineOrder: ['local', 'server'] });
  await start();
  await recordHotkeyAndOpenEngineStep();
  await expect(engines().getByRole('radio', { name: /^Na tomto Macu/ })).not.toBeChecked();

  await engines().getByRole('radio', { name: /^Na tomto Macu/ }).check();
  await expect(modelList()).toBeVisible();
  await expect.poll(async () => (await savedSettings()).engineOrder).toEqual(['local']);
  await expectNoModelDownload();
});

test('choosing this Mac shows the preselected recommended model, then onboarding is skipped after completion', async () => {
  await recordHotkeyAndOpenEngineStep();
  await engines().getByRole('radio', { name: /^Na tomto Macu/ }).check();
  await expect(modelList().getByRole('radio', { name: DEFAULT_MODEL_NAME, exact: true })).toBeChecked();
  await expect(modelList().getByRole('radio')).toHaveCount(4);
  await expect(page.locator('.ob-model-actions').getByRole('button', { name: `Stiahnuť: ${DEFAULT_MODEL_NAME}` })).toBeVisible();
  await modelList().getByRole('radio', { name: 'Canary 1B v2' }).check();
  await expect(page.locator('.ob-model-actions').getByRole('button', { name: 'Stiahnuť: Canary 1B v2' })).toBeVisible();
  await expect(engines().getByRole('radio', { name: /^Na tomto Macu/ })).toBeChecked();

  await next();
  await expect(heading()).toHaveText('Vyskúšajte to');
  await expect(page.locator('.ob-try')).toHaveText('Stlačte Pravý ⌃ Control a povedzte niečo.');
  await expect(page.getByText('Model sa ešte sťahuje alebo nie je vybraný.')).toBeVisible();
  await page.getByRole('button', { name: 'Späť' }).click();
  await expect(engines().getByRole('radio', { name: /^Na tomto Macu/ })).toBeChecked();
  await next();
  await page.getByRole('button', { name: 'Dokončiť' }).click();

  await expect(page.getByRole('tablist', { name: 'Sekcie aplikácie' })).toBeVisible();
  await expect.poll(async () => (await savedSettings()).onboardingDone).toBe(true);
  expect((await savedSettings()).engineOrder).toEqual(['local']);
  await expectNoModelDownload();

  await app.close();
  await start();
  await expect(page.getByRole('tablist', { name: 'Sekcie aplikácie' })).toBeVisible();
  await expect(page.getByText('Krok 1 z 5')).toHaveCount(0);
});

test('choosing an own server pairs it in place, saves the server order and never suggests a model download', async () => {
  const server = await startLocalGateway();
  gateway = server;
  await recordHotkeyAndOpenEngineStep();
  await engines().getByRole('radio', { name: /^Na vlastnom serveri/ }).check();
  await expect(page.getByRole('heading', { name: 'Spárovať server' })).toBeVisible();
  await expect(modelList()).toHaveCount(0);
  await expect.poll(async () => (await savedSettings()).engineOrder).toEqual(['server']);

  const window = await server.openPairingWindow();
  await page.getByRole('textbox', { name: 'Párovací token' }).fill(window.token);
  await page.getByRole('button', { name: 'Spárovať', exact: true }).click();
  await window.admin.next();
  window.admin.send({ decision: 'approve' });
  const paired = (await window.admin.next()) as PairedEvent;
  window.admin.close();
  await expect(page.getByRole('status').filter({ hasText: 'Spárované so serverom' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Párovací token' })).toHaveCount(0);

  await next();
  await expect(heading()).toHaveText('Vyskúšajte to');
  await expect(page.locator('.ob-try')).toHaveText('Stlačte Pravý ⌃ Control a povedzte niečo.');
  await expect(page.locator('.ob-body .field-note')).toHaveCount(0);
  await page.getByRole('button', { name: 'Dokončiť' }).click();

  await expect(page.getByRole('tablist', { name: 'Sekcie aplikácie' })).toBeVisible();
  await expect(page.locator('.banner')).toContainText('Všetko je pripravené.');
  await expect(page.locator('.banner')).not.toContainText('Stiahnite si model na prepis reči.');
  expect((await savedSettings()).engineOrder).toEqual(['server']);
  expect(await server.admin({ cmd: 'devices' })).toMatchObject({ devices: [{ id: paired.deviceId }] });
  await expectNoModelDownload();
});
