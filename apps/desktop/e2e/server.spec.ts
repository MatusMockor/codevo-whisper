import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pairingStep } from '../src/renderer/server/server-copy';
import type { Settings } from '../src/shared/settings';
import { mainWindow } from './app-windows';
import { createUserDataDir, FAKE_MEDIA_ARGS, launchApp, ONBOARDED, removeUserDataDir } from './launch-app';
import { startLocalGateway, type LocalGateway } from './local-gateway';

type RequestEvent = { event: 'request'; deviceName: string; deviceFingerprint: string; handshakeFingerprint: string };
type PairedEvent = { event: 'paired'; deviceId: string };

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let gateway: LocalGateway;

async function start(): Promise<void> {
  app = await launchApp(userDataDir, FAKE_MEDIA_ARGS, { fakeHelper: true });
  page = await mainWindow(app);
}

async function savedSettings(): Promise<Settings> {
  return JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as Settings;
}

async function engineOrder(): Promise<Settings['engineOrder']> {
  return (await savedSettings()).engineOrder;
}

function card(): Locator {
  return page.locator('.server-card');
}

function nowCard(): Locator {
  return page.locator('.now');
}

function route(): Locator {
  return page.locator('.route-card');
}

async function pair(): Promise<PairedEvent> {
  const window = await gateway.openPairingWindow();
  await page.getByRole('textbox', { name: 'Párovací token' }).fill(window.token);
  await page.getByRole('button', { name: 'Spárovať', exact: true }).click();
  await window.admin.next();
  window.admin.send({ decision: 'approve' });
  const paired = (await window.admin.next()) as PairedEvent;
  window.admin.close();
  await expect(card().locator('.pill')).toHaveText('Online');
  return paired;
}

const PAGE_HEADINGS = { Prepis: 'Kde beží prepis', Nastavenia: 'Nastavenia', Domov: 'Signálna cesta diktovania' } as const;

async function openTab(name: keyof typeof PAGE_HEADINGS): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(PAGE_HEADINGS[name]);
}

test.beforeEach(async () => {
  gateway = await startLocalGateway();
  userDataDir = await createUserDataDir(ONBOARDED);
  await start();
});

test.afterEach(async () => {
  await app.close();
  await gateway.close();
  await removeUserDataDir(userDataDir);
});

test('pairs by pasting the token, shows the same fingerprint as the server and survives a relaunch', async () => {
  await openTab('Prepis');
  await expect(page.getByRole('heading', { name: 'Spárovať server' })).toBeVisible();
  await expect(page.locator('.term')).toContainText(pairingStep(process.platform === 'linux').command);
  const window = await gateway.openPairingWindow();

  await page.getByRole('textbox', { name: 'Párovací token' }).fill(window.token);
  await page.getByRole('button', { name: 'Spárovať', exact: true }).click();

  const request = (await window.admin.next()) as RequestEvent;
  await expect(page.locator('[data-fingerprint="connection"]')).toHaveText(request.handshakeFingerprint);
  await expect(page.locator('[data-fingerprint="device"]')).toHaveText(request.deviceFingerprint);
  await expect(page.getByText('Čaká sa na potvrdenie na serveri')).toBeVisible();
  window.admin.send({ decision: 'approve' });
  const paired = (await window.admin.next()) as PairedEvent;
  window.admin.close();

  await expect(card().locator('.pill')).toHaveText('Online');
  await expect(card()).toContainText(`127.0.0.1:${gateway.port}`);
  await expect(card()).toContainText(paired.deviceId);
  await expect(card()).toContainText(request.deviceName);
  await expect(card().locator('[data-fingerprint="device"]')).toHaveText(request.deviceFingerprint);
  await expect(card()).not.toContainText('–');
  await expect(page.getByRole('textbox', { name: 'Párovací token' })).toHaveCount(0);
  const notice = page.getByRole('status').filter({ hasText: 'Prepis sa prepol na server' });
  await expect(notice).toHaveText(`Spárované. Prepis sa prepol na server 127.0.0.1:${gateway.port}. Lokálny model nemáte stiahnutý, takže bez tohto kroku by diktovanie nefungovalo.Vrátiť späť`);
  await expect.poll(engineOrder).toEqual(['server']);
  await expect(nowCard()).toContainText(`Prepisuje sa na: Server 127.0.0.1:${gateway.port}`);

  await expect(nowCard()).toContainText('Prepis je pripravený, diktovanie však zatiaľ nefunguje. Nastavte klávesovú skratku, ktorou budete diktovať.');
  await expect(page.locator('.sbar-ready')).toContainText('Diktovanie nefunguje');

  await notice.getByRole('button', { name: 'Vrátiť späť' }).click();

  await expect.poll(engineOrder).toEqual(['local']);
  await expect(notice).toHaveCount(0);
  await expect(route().getByRole('button', { name: `Pridať server 127.0.0.1:${gateway.port} ako zálohu` })).toBeVisible();

  await app.close();
  await start();
  await openTab('Prepis');
  await expect(card().locator('.pill')).toHaveText('Online');
  await expect(card()).toContainText(paired.deviceId);
});

test('the route offers the server only after pairing and unpairing drops it and gives the revoke command', async () => {
  await openTab('Prepis');
  await expect(route()).toContainText('Server ako záloha bude dostupný po spárovaní.');

  const paired = await pair();
  await expect.poll(engineOrder).toEqual(['server']);
  await route().getByRole('button', { name: 'Pridať lokálny prepis ako zálohu' }).click();
  await expect.poll(engineOrder).toEqual(['server', 'local']);
  await expect(route()).toContainText('Trasa: Server, potom lokálne.');
  await route().getByRole('button', { name: 'Vymeniť hlavný prepis a zálohu' }).click();
  await expect.poll(engineOrder).toEqual(['local', 'server']);
  await route().getByRole('button', { name: 'Odobrať zálohu' }).click();
  await expect.poll(engineOrder).toEqual(['local']);
  await route().getByRole('button', { name: `Pridať server 127.0.0.1:${gateway.port} ako zálohu` }).click();
  await expect.poll(engineOrder).toEqual(['local', 'server']);

  await card().getByRole('button', { name: 'Zrušiť párovanie' }).click();
  const command = `revoke ${paired.deviceId}`;
  await expect(card()).toContainText(command);
  await page.getByRole('button', { name: 'Áno, zrušiť párovanie' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Párovanie je zrušené' })).toContainText(command);
  await expect(card()).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Párovací token' })).toBeVisible();
  await expect.poll(engineOrder).toEqual(['local']);
  expect(await gateway.admin({ cmd: 'devices' })).toMatchObject({ devices: [{ id: paired.deviceId }] });
});

test('disconnecting the server keeps the pairing, warns without a local model and restores the route when connected again', async () => {
  await openTab('Prepis');
  await pair();
  await route().getByRole('button', { name: 'Pridať lokálny prepis ako zálohu' }).click();
  await expect.poll(engineOrder).toEqual(['server', 'local']);
  const disconnect = card().getByRole('button', { name: 'Odpojiť server', exact: true });
  await expect(disconnect).toHaveText('Odpojiť');
  await expect(card().getByRole('button', { name: 'Zrušiť párovanie' })).toBeVisible();

  await disconnect.click();
  const confirm = page.getByRole('alertdialog', { name: 'Odpojiť server' });
  await expect(confirm).toHaveAccessibleDescription(/po odpojení servera diktovanie nebude fungovať/);
  await expect(page.getByRole('button', { name: 'Nechať pripojený' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirm).toHaveCount(0);
  await expect(disconnect).toBeFocused();
  await disconnect.press('Space');
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(disconnect).toBeFocused();
  await expect.poll(engineOrder).toEqual(['server', 'local']);
  await disconnect.click();
  await confirm.getByRole('button', { name: 'Odpojiť server', exact: true }).click();

  const connect = card().getByRole('button', { name: 'Pripojiť server', exact: true });
  await expect(connect).toHaveText('Pripojiť');
  await expect(connect).toHaveClass(/primary/);
  await expect(connect).toBeFocused();
  await expect(card().locator('.pill')).toHaveText('Odpojený');
  await expect(card()).toContainText('Server je odpojený');
  await expect(card()).toContainText('Pripojiť ho znova pripojí bez nového párovania');
  await expect(card()).toContainText('Po pripojení sa obnoví trasa Server, potom lokálne.');
  await expect.poll(savedSettings).toMatchObject({ engineOrder: ['local'], serverEnabled: false, serverRestoreOrder: ['server', 'local'] });
  await expect(nowCard()).toContainText('Lokálny model chýba');
  await expect(nowCard().getByRole('button')).toHaveText(['Pripojiť server', 'Stiahnuť model']);
  await expect(route()).toContainText('Server je odpojený. Po pripojení ho môžete pridať ako zálohu.');

  await app.close();
  await start();
  await openTab('Prepis');
  await expect(card().locator('.pill')).toHaveText('Odpojený');

  await nowCard().getByRole('button', { name: 'Pripojiť server' }).click();

  await expect.poll(savedSettings).toMatchObject({ engineOrder: ['server', 'local'], serverEnabled: true, serverRestoreOrder: null });
  await expect(card().locator('.pill')).toHaveText('Online');
  await expect(nowCard()).toContainText(`Prepisuje sa na: Server 127.0.0.1:${gateway.port}`);
  await card().getByRole('button', { name: 'Odpojiť server', exact: true }).click();
  await page.getByRole('alertdialog', { name: 'Odpojiť server' }).getByRole('button', { name: 'Odpojiť server', exact: true }).click();
  await expect(card().locator('.pill')).toHaveText('Odpojený');
  await card().getByRole('button', { name: 'Pripojiť server', exact: true }).click();
  await expect(card().locator('.pill')).toHaveText('Online');
  await expect(card().getByRole('button', { name: 'Odpojiť server', exact: true })).toBeFocused();
  await expect.poll(engineOrder).toEqual(['server', 'local']);
});

test('explains an unreachable server, offers a retry and never shows placeholder values', async () => {
  await openTab('Prepis');
  await pair();
  await gateway.close();
  gateway = await startLocalGateway();

  await card().getByRole('button', { name: 'Otestovať spojenie' }).click();

  await expect(card().locator('.pill')).toHaveText('Neodpovedá');
  const panel = card().getByRole('status').filter({ hasText: 'Server neodpovedá' });
  await expect(panel).toContainText('ws://127.0.0.1:');
  await expect(panel).toContainText('SSH tunel');
  await expect(panel.getByRole('button', { name: 'Skúsiť znova' })).toBeVisible();
  await expect(card()).not.toContainText('–');
  await expect(card()).not.toContainText('Verzia servera');
  await expect(nowCard()).toContainText('Server neodpovedá');
});

test('an invalid token shows an inline error and contacts no server', async () => {
  await openTab('Prepis');

  await page.getByRole('textbox', { name: 'Párovací token' }).fill('K7QM-4XPB');
  await page.getByRole('button', { name: 'Spárovať', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('Toto nie je platný párovací token.');
  expect(await gateway.admin({ cmd: 'status' })).toMatchObject({ devices: 0, activeSessions: 0 });
});

test('shows a server that needs re-pairing after a revoke', async () => {
  await openTab('Prepis');
  const paired = await pair();
  await expect.poll(engineOrder).toEqual(['server']);

  await gateway.admin({ cmd: 'revoke', deviceId: paired.deviceId });
  await card().getByRole('button', { name: 'Otestovať spojenie' }).click();

  await expect(card().locator('.pill')).toHaveText('Treba znova spárovať');
  await expect(card().getByRole('alert')).toContainText('Server toto zariadenie nepozná');
  await expect(page.getByRole('heading', { name: 'Spárovať nový server' })).toBeVisible();
  await openTab('Domov');
  await expect(page.locator('.banner')).toContainText('Server treba znova spárovať.');
  await page.locator('.banner').getByRole('button', { name: 'Otvoriť server' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kde beží prepis');
  await expect(page.getByRole('heading', { level: 2, name: 'Vlastný server' })).toBeFocused();
});

test('Home offers the paired server when the local model is missing and switches in one click', async () => {
  await openTab('Prepis');
  await pair();
  await expect.poll(engineOrder).toEqual(['server']);
  await page.evaluate(() => window.codevo.updateSettings({ hotkey: { kind: 'modifiers', keycodes: [62], label: 'Pravý ⌃ Control' }, engineOrder: ['local'] }));
  await expect.poll(engineOrder).toEqual(['local']);

  await openTab('Domov');
  const footer = page.locator('.banner');
  const useServer = `Prepisovať na serveri 127.0.0.1:${gateway.port}`;
  await expect(footer).toContainText('Lokálny model nie je stiahnutý.');
  await expect(footer.getByRole('button')).toHaveText(['Stiahnuť model', useServer]);
  await expect(footer.getByRole('button', { name: useServer })).toHaveClass(/primary/);
  await expect(page.getByRole('region', { name: 'Od klávesu po vložený text' }).locator('.node', { hasText: 'Prepis' })).toHaveClass(/\berr\b/);

  await footer.getByRole('button', { name: useServer }).click();

  await expect.poll(engineOrder).toEqual(['server']);
  await expect(footer).not.toContainText('Lokálny model nie je stiahnutý.');
  await expect(page.getByRole('region', { name: 'Od klávesu po vložený text' }).locator('.node', { hasText: 'Prepis' })).not.toHaveClass(/\berr\b/);
});

test('the current state warns about a route that cannot work and fixes it in one click', async () => {
  await openTab('Prepis');
  await expect(nowCard()).toContainText('Lokálny model chýba');
  await nowCard().getByRole('button', { name: 'Stiahnuť model' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Lokálny model', exact: true })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Lokálny model' })).toBeInViewport();

  await pair();
  await expect(nowCard()).toContainText(`Prepisuje sa na: Server 127.0.0.1:${gateway.port}`);

  await page.evaluate(() => window.codevo.updateSettings({ engineOrder: ['local'] }));
  await expect(nowCard()).toContainText('Lokálny model chýba');
  await nowCard().getByRole('button', { name: `Prepisovať na serveri 127.0.0.1:${gateway.port}` }).click();

  await expect.poll(engineOrder).toEqual(['server']);
  await expect(nowCard()).toContainText(`Prepisuje sa na: Server 127.0.0.1:${gateway.port}`);
});
