import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mainWindow } from './app-windows';
import { createUserDataDir, launchApp, ONBOARDED, removeUserDataDir } from './launch-app';
import { startLocalGateway, type LocalGateway } from './local-gateway';

// Opt in: these checks post real keys/clicks and move desktop focus.
test.skip(process.platform !== 'darwin' || process.env['CW_MAC_NATIVE_ACCEPTANCE'] !== '1', 'requires opt-in macOS desktop');

type FixtureState = { first: string; second: string; keyWindow: string };
let fixture: ChildProcessWithoutNullStreams;
let lines: ReturnType<typeof createInterface>;
let app: ElectronApplication;
let page: Page;
let dir: string;
let gateway: LocalGateway;

function command(value: string): Promise<FixtureState> {
  return new Promise((resolve) => {
    lines.once('line', (line) => resolve(JSON.parse(line) as FixtureState));
    fixture.stdin.write(`${value}\n`);
  });
}

async function overlay(): Promise<Page> {
  await expect.poll(() => app.windows().some((window) => window.url().endsWith('/overlay/overlay.html'))).toBe(true);
  return app.windows().find((window) => window.url().endsWith('/overlay/overlay.html'))!;
}

async function startRecording(): Promise<Page> {
  await app.evaluate(() => { (globalThis as unknown as { nativeFrames: number }).nativeFrames = 0; });
  await expect.poll(async () => {
    await command('first');
    return (await command('state')).keyWindow;
  }).toBe('CODWHI-43 fixture 0');
  await expect.poll(() => app.evaluate(async () => {
    const hooks = globalThis as unknown as { codevoE2e: { helper: { frontmost(): Promise<{ name: string }> } } };
    return (await hooks.codevoE2e.helper.frontmost()).name;
  })).toContain('codwhi-43-fixture');
  await command('record');
  const panel = await overlay();
  await expect(panel.getByRole('status', { name: 'Nahrávam' })).toBeVisible();
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { nativeFrames: number }).nativeFrames)).toBeGreaterThan(3);
  return panel;
}

async function nativeClick(panel: Page, name: RegExp): Promise<void> {
  const box = await panel.getByRole('button', { name }).boundingBox();
  expect(box).not.toBeNull();
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/overlay/overlay.html'))!.getBounds());
  await command(`click ${bounds.x + box!.x + box!.width / 2} ${bounds.y + box!.y + box!.height / 2}`);
}

test.beforeEach(async () => {
  const binary = test.info().outputPath('codwhi-43-fixture');
  await promisify(execFile)('swiftc', ['-swift-version', '6', '-warnings-as-errors', fileURLToPath(new URL('../../../native/macos-helper/test/acceptance/main.swift', import.meta.url)), '-o', binary]);
  fixture = spawn(binary);
  lines = createInterface({ input: fixture.stdout });
  await new Promise<void>((resolve) => lines.once('line', () => resolve()));
  gateway = await startLocalGateway({ sttDelayMs: 1500 });
  dir = await createUserDataDir({ ...ONBOARDED, hotkey: { kind: 'modifiers', keycodes: [61], label: 'Right Option' }, mode: 'toggle', insertion: 'type', appendTrailingSpace: false });
  app = await launchApp(dir);
  page = await mainWindow(app);
  await app.evaluate(() => {
    const hooks = globalThis as unknown as { nativeFrames: number; codevoE2e: { capture: { onFrame(listener: () => void): void } } };
    hooks.nativeFrames = 0;
    hooks.codevoE2e.capture.onFrame(() => { hooks.nativeFrames++; });
  });
  const permissions = await app.evaluate(async () => {
    const hooks = globalThis as unknown as { codevoE2e: { helper: { permissions(): Promise<unknown> } } };
    return hooks.codevoE2e.helper.permissions();
  });
  expect(permissions, 'Enable Accessibility and Input Monitoring for development Electron before running native acceptance').toMatchObject({ accessibility: true, listen: true });
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
  try {
    await app?.close();
  } finally {
    try {
      await gateway?.close();
    } finally {
      fixture?.stdin.end();
      lines?.close();
      if (dir) await removeUserDataDir(dir);
    }
  }
});

for (const mode of ['recording', 'transcribing', 'click']) {
  test(`native cancellation during ${mode} preserves the target`, async () => {
    const panel = await startRecording();
    if (mode === 'transcribing') {
      await expect.poll(() => command('state').then((state) => state.first)).toBe('before AFTER');
      await new Promise((resolve) => setTimeout(resolve, 350));
      await command('record');
      await expect(panel.getByText('Spracúvam', { exact: true })).toBeVisible();
    }
    if (mode === 'click') await nativeClick(panel, /Zrušiť/);
    if (mode !== 'click') await command('escape');
    await expect(panel.locator('.stage > *')).toHaveCount(0);
    await expect.poll(() => command('state')).toMatchObject({ first: 'before AFTER', second: 'other field' });
    await command('probe');
    await expect.poll(() => command('state')).toMatchObject({ first: 'before probeAFTER', second: 'other field' });
  });
}

for (const lock of ['shortcut', 'click']) {
  test(`native ${lock} target lock inserts at captured caret and returns to other window`, async () => {
    const panel = await startRecording();
    if (lock === 'shortcut') await command('lock');
    if (lock === 'click') await nativeClick(panel, /Uzamknúť/);
    await expect(panel.locator('.ov-target')).toHaveAttribute('aria-pressed', 'true');
    await command('second');
    await command('record');
    await expect.poll(() => command('state'), { timeout: 15_000 }).toMatchObject({ first: 'before prepis zo serveraAFTER', second: 'other field', keyWindow: 'CODWHI-43 fixture 1' });
  });
}

test('a removed locked field receives nothing and never types into the other field', async () => {
  const panel = await startRecording();
  await command('lock');
  await expect(panel.locator('.ov-target')).toHaveAttribute('aria-pressed', 'true');
  await command('second');
  await command('remove');
  await command('record');
  await expect(panel.getByRole('alert')).toContainText('Okno sa zmenilo');
  expect(await command('state')).toMatchObject({ first: 'before AFTER', second: 'other field' });
});

test('native field context reaches the polish request without editing the field', async () => {
  const bodies: string[] = [];
  const replies: ServerResponse[] = [];
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'));
      replies.push(outgoing);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    await page.evaluate((aiBaseUrl) => window.codevo.updateSettings({ aiPolish: true, aiBaseUrl, aiModel: 'fixture' }), baseUrl);
    await startRecording();
    await new Promise((resolve) => setTimeout(resolve, 350));
    await command('record');
    await expect.poll(() => bodies.length).toBe(1);
    const request = JSON.parse(bodies[0]!) as { messages: Array<{ role: string; content: string }> };
    const user = request.messages.find((message) => message.role === 'user');
    expect(JSON.parse(user!.content)).toMatchObject({ context: { before: 'before ', after: 'AFTER' } });
    expect(await command('state')).toMatchObject({ first: 'before AFTER', second: 'other field' });
    replies[0]!.writeHead(200, { 'content-type': 'application/json' });
    replies[0]!.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Prepis zo servera.' } }] }));
    await expect.poll(() => command('state'), { timeout: 10_000 }).toMatchObject({ first: 'before Prepis zo servera.AFTER', second: 'other field' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
