import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pairingStep } from '../src/renderer/server/server-copy';
import type { Settings } from '../src/shared/settings';
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
  page = await app.firstWindow();
}

async function engineOrder(): Promise<Settings['engineOrder']> {
  return (JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as Settings).engineOrder;
}

async function pair(): Promise<PairedEvent> {
  const window = await gateway.openPairingWindow();
  await page.getByRole('textbox', { name: 'Párovací token' }).fill(window.token);
  await page.getByRole('button', { name: 'Spárovať', exact: true }).click();
  await window.admin.next();
  window.admin.send({ decision: 'approve' });
  const paired = (await window.admin.next()) as PairedEvent;
  window.admin.close();
  await expect(page.locator('.server-card .pill')).toHaveText('Online');
  return paired;
}

const PAGE_HEADINGS = { Server: 'Server', Nastavenia: 'Nastavenia', Domov: 'Signálna cesta diktovania' } as const;

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
  await openTab('Server');
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

  const card = page.locator('.server-card');
  await expect(card.locator('.pill')).toHaveText('Online');
  await expect(card).toContainText(`127.0.0.1:${gateway.port}`);
  await expect(card).toContainText(paired.deviceId);
  await expect(card).toContainText(request.deviceName);
  await expect(card.locator('[data-fingerprint="device"]')).toHaveText(request.deviceFingerprint);
  await expect(page.getByText(`Server pozná tento počítač ako ${paired.deviceId}.`)).toBeVisible();
  const notice = page.getByRole('status').filter({ hasText: 'Prepis sa prepol na server' });
  await expect(notice).toHaveText(`Spárované. Prepis sa prepol na server 127.0.0.1:${gateway.port}. Lokálny model nemáte stiahnutý, takže bez tohto kroku by diktovanie nefungovalo.Vrátiť späť`);
  await expect.poll(engineOrder).toEqual(['server']);
  await expect(card.getByRole('button', { name: 'Prepisovať na serveri' })).toHaveCount(0);

  await notice.getByRole('button', { name: 'Vrátiť späť' }).click();

  await expect.poll(engineOrder).toEqual(['local']);
  await expect(notice).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Prepisovať na serveri' })).toBeVisible();

  await app.close();
  await start();
  await openTab('Server');
  await expect(page.locator('.server-card .pill')).toHaveText('Online');
  await expect(page.locator('.server-card')).toContainText(paired.deviceId);
});

test('Kde beží prepis offers the server orders only after pairing and disconnecting switches back to local', async () => {
  await openTab('Nastavenia');
  const engines = page.getByRole('radiogroup', { name: 'Kde beží prepis' });
  await expect(engines.getByRole('radio', { name: /^Lokálne/ }).first()).toBeChecked();
  await expect(engines.getByRole('radio', { name: /^Server/ }).first()).toBeDisabled();
  await expect(page.getByText('Najprv spárujte server na stránke Server.')).toBeVisible();

  await openTab('Server');
  const window = await gateway.openPairingWindow();
  await page.getByRole('textbox', { name: 'Párovací token' }).fill(window.token);
  await page.getByRole('button', { name: 'Spárovať', exact: true }).click();
  await window.admin.next();
  window.admin.send({ decision: 'approve' });
  const paired = (await window.admin.next()) as PairedEvent;
  window.admin.close();
  await expect(page.locator('.server-card .pill')).toHaveText('Online');

  await openTab('Nastavenia');
  await engines.getByRole('radio', { name: /^Server, potom lokálne/ }).click();
  await expect(engines.getByRole('radio', { name: /^Server, potom lokálne/ })).toBeChecked();
  await expect
    .poll(async () => (JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as Settings).engineOrder)
    .toEqual(['server', 'local']);

  await openTab('Server');
  await page.getByRole('button', { name: 'Odpojiť server' }).click();
  const command = `revoke ${paired.deviceId}`;
  await expect(page.locator('.server-card')).toContainText(command);
  await page.getByRole('button', { name: 'Áno, odpojiť' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Server je odpojený' })).toContainText(command);
  await expect(page.locator('.server-card')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Párovací token' })).toBeVisible();
  await expect
    .poll(async () => (JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as Settings).engineOrder)
    .toEqual(['local']);
  expect(await gateway.admin({ cmd: 'devices' })).toMatchObject({ devices: [{ id: paired.deviceId }] });
});

test('an invalid token shows an inline error and contacts no server', async () => {
  await openTab('Server');

  await page.getByRole('textbox', { name: 'Párovací token' }).fill('K7QM-4XPB');
  await page.getByRole('button', { name: 'Spárovať', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('Toto nie je platný párovací token.');
  expect(await gateway.admin({ cmd: 'status' })).toMatchObject({ devices: 0, activeSessions: 0 });
});

test('shows a server that needs re-pairing after a revoke', async () => {
  await openTab('Server');
  const window = await gateway.openPairingWindow();
  await page.getByRole('textbox', { name: 'Párovací token' }).fill(window.token);
  await page.getByRole('button', { name: 'Spárovať', exact: true }).click();
  await window.admin.next();
  window.admin.send({ decision: 'approve' });
  const paired = (await window.admin.next()) as PairedEvent;
  window.admin.close();
  await expect(page.locator('.server-card .pill')).toHaveText('Online');

  await expect(page.getByRole('button', { name: 'Prepisovať na serveri' })).toHaveCount(0);
  await expect.poll(engineOrder).toEqual(['server']);

  await gateway.admin({ cmd: 'revoke', deviceId: paired.deviceId });
  await page.getByRole('button', { name: 'Otestovať spojenie' }).click();

  await expect(page.locator('.server-card .pill')).toHaveText('Treba znova spárovať');
  await expect(page.locator('.server-card').getByRole('alert')).toContainText('Server toto zariadenie nepozná');
  await openTab('Domov');
  await expect(page.locator('.banner')).toContainText('Server treba znova spárovať.');
  await page.locator('.banner').getByRole('button', { name: 'Otvoriť Server' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Server');
});

test('Kde beží prepis warns about an order that cannot work and fixes it in one click', async () => {
  await openTab('Nastavenia');
  const engines = page.getByRole('radiogroup', { name: 'Kde beží prepis' });
  const warning = page.locator('.engine-fix');
  await expect(warning).toContainText('Lokálny model nemáte stiahnutý a server nie je spárovaný');
  await warning.getByRole('button', { name: 'Stiahnuť model' }).click();
  await expect(page.getByRole('region', { name: 'Lokálny model' })).toBeFocused();

  await openTab('Server');
  await pair();
  await openTab('Nastavenia');
  await expect(engines.getByRole('radio', { name: /^Server/ }).first()).toBeChecked();
  await expect(warning).toHaveCount(0);

  await engines.getByRole('radio', { name: /^Lokálne/ }).first().click();
  await expect(warning).toContainText('Lokálny model nemáte stiahnutý, takže s touto voľbou diktovanie nebude fungovať.');
  await warning.getByRole('button', { name: 'Prepisovať na serveri' }).click();

  await expect.poll(engineOrder).toEqual(['server']);
  await expect(engines.getByRole('radio', { name: /^Server/ }).first()).toBeChecked();
  await expect(warning).toHaveCount(0);
});
