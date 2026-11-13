import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { findCodex } from '../src/main/ai/codex-cli';
import type { E2eHooks } from '../src/main/app/e2e-hooks';
import type { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import type { Settings } from '../src/shared/settings';
import { mainWindow } from './app-windows';
import { createUserDataDir, FAKE_MEDIA_ARGS, launchApp, ONBOARDED, removeUserDataDir } from './launch-app';
import { startLocalGateway, type LocalGateway } from './local-gateway';

type Hooks = { codevoE2e: E2eHooks & { helper: FakeInputHelper }; aiFrames: number };
type Exchange = { method: string; path: string; request: string; response: string };

const OLLAMA = 'http://127.0.0.1:11434';
const MODEL = 'qwen2.5:1.5b';
const RAW = 'prepis zo servera';

let app: ElectronApplication | null = null;
let page: Page;
let dir: string | null = null;
let gateway: LocalGateway | null = null;
const servers: Server[] = [];
const originalEnv = { PATH: process.env['PATH'], HOME: process.env['HOME'] };

async function ollamaOffers(model: string): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA}/v1/models`, { signal: AbortSignal.timeout(3_000) });
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    return body.data?.some((entry) => entry.id === model) ?? false;
  } catch {
    return false;
  }
}

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}

async function recordingProxy(): Promise<{ baseUrl: string; exchanges: Exchange[] }> {
  const exchanges: Exchange[] = [];
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const request = Buffer.concat(chunks).toString('utf8');
      const method = incoming.method ?? 'GET';
      const path = incoming.url ?? '/';
      void fetch(`${OLLAMA}${path}`, { method, headers: { 'content-type': 'application/json', ...(incoming.headers.authorization === undefined ? {} : { authorization: incoming.headers.authorization }) }, body: method === 'GET' ? null : request }).then(async (answer) => {
        const response = await answer.text();
        exchanges.push({ method, path, request, response });
        outgoing.writeHead(answer.status, { 'content-type': 'application/json' });
        outgoing.end(response);
      });
    });
  });
  return { baseUrl: await listen(server), exchanges };
}

async function start(settings: Partial<Settings>): Promise<void> {
  dir = await createUserDataDir({ ...ONBOARDED, hotkey: { kind: 'modifiers', keycodes: [63], label: 'Fn' }, mode: 'hold', ...settings });
  const launched = await launchApp(dir, FAKE_MEDIA_ARGS, { fakeHelper: true });
  app = launched;
  page = await mainWindow(launched);
  await launched.evaluate(() => {
    const hooks = globalThis as unknown as Hooks;
    hooks.aiFrames = 0;
    hooks.codevoE2e.capture.onFrame(() => { hooks.aiFrames++; });
  });
}

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

async function dictate(): Promise<{ text: string; afterReleaseMs: number }> {
  const app = launched();
  const frames = await app.evaluate(() => (globalThis as unknown as Hooks).aiFrames);
  await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.emitHotkey('down'));
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as Hooks).aiFrames)).toBeGreaterThan(frames + 2);
  await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.emitHotkey('up'));
  const released = Date.now();
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.pasted.length), { timeout: 30_000 }).toBe(1);
  const afterReleaseMs = Date.now() - released;
  const [text = ''] = await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.pasted);
  return { text, afterReleaseMs };
}

function launched(): ElectronApplication {
  if (app === null) throw new Error('the app is not running');
  return app;
}

function section() {
  return page.getByRole('region', { name: 'AI úprava textu', exact: true });
}

async function shoot(name: string): Promise<void> {
  await section().scrollIntoViewIfNeeded();
  await section().screenshot({ path: test.info().outputPath(name) });
}

test.afterEach(async () => {
  await app?.close();
  app = null;
  await gateway?.close();
  gateway = null;
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })));
  if (dir !== null) await removeUserDataDir(dir);
  dir = null;
  restoreEnv();
});

function restoreEnv(): void {
  process.env['PATH'] = originalEnv.PATH;
  process.env['HOME'] = originalEnv.HOME;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startWithCodex(codex: string | null): Promise<void> {
  const home = test.info().outputPath('home');
  await mkdir(home, { recursive: true });
  process.env['PATH'] = codex === null ? '/usr/bin:/bin' : `${dirname(codex)}:/usr/bin:/bin`;
  process.env['HOME'] = home;
  await start({ aiPolish: true, aiProvider: 'codex' });
  restoreEnv();
}

async function overlayNotice(notice: string, screenshot: string): Promise<void> {
  const overlay = launched().windows().find((window) => window.url().endsWith('/overlay/overlay.html'));
  expect(overlay).toBeTruthy();
  await expect(overlay!.getByText(notice, { exact: true })).toBeVisible();
  await expect(overlay!.getByText('Vložené')).toBeVisible();
  await overlay!.screenshot({ path: test.info().outputPath(screenshot) });
}

test('settings connect to the local Ollama and the dictation is inserted as the model edited it', async () => {
  test.skip(!(await ollamaOffers(MODEL)), `requires Ollama at ${OLLAMA} with ${MODEL}`);
  test.setTimeout(120_000);
  const proxy = await recordingProxy();
  await start({});
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  const polishSwitch = section().getByRole('switch', { name: 'Upraviť diktát cez AI' });
  await expect(polishSwitch).toBeDisabled();
  await shoot('ai-settings-empty.png');

  await section().getByLabel('Adresa servera (OpenAI-compatible)').fill(proxy.baseUrl);
  await section().getByRole('button', { name: 'Overiť pripojenie' }).click();
  await expect(section().getByText(/^Spojenie funguje\. Dostupné modely: \d+\.$/)).toBeVisible();
  expect(await section().locator('datalist option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))).toContain(MODEL);
  await section().getByLabel('Model', { exact: true }).fill(MODEL);
  await expect(polishSwitch).toBeEnabled();
  await polishSwitch.click();
  await expect(polishSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(section().getByText('Text sa odošle mimo tento počítač.')).toHaveCount(0);
  await shoot('ai-settings-connected.png');
  await expect.poll(() => page.evaluate(() => window.codevo.getSettings())).toMatchObject({ aiBaseUrl: proxy.baseUrl, aiModel: MODEL, aiPolish: true });

  await pair();
  const { text } = await dictate();

  const chats = proxy.exchanges.filter((exchange) => exchange.method === 'POST' && exchange.path === '/v1/chat/completions');
  expect(chats).toHaveLength(1);
  const sent = JSON.parse(chats[0]!.request) as { model: string; messages: Array<{ role: string; content: string }>; stream: boolean };
  expect(sent).toMatchObject({ model: MODEL, stream: false });
  expect(JSON.parse(sent.messages.at(-1)!.content)).toEqual({ transcript: RAW });
  const answered = (JSON.parse(chats[0]!.response) as { choices: Array<{ message: { content: string } }> }).choices[0]!.message.content;
  expect(text).toBe(answered.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').replace(/\s+/g, ' ').trim());
  expect(await page.evaluate(() => window.codevo.getLastTranscript())).toBe(text);
  console.log(JSON.stringify({ raw: RAW, polished: text, model: MODEL }));

  await section().getByLabel('Adresa servera (OpenAI-compatible)').fill('https://llm.example.com/v1');
  await expect(section().getByText('Text sa odošle mimo tento počítač.')).toBeVisible();
  await shoot('ai-settings-non-local.png');
});

test('an invalid address draft still shows polish as on and lets the user turn it off', async () => {
  await start({ aiBaseUrl: 'http://127.0.0.1:9/v1', aiModel: MODEL, aiPolish: true });
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  const polishSwitch = section().getByRole('switch', { name: 'Upraviť diktát cez AI' });
  await section().getByLabel('Adresa servera (OpenAI-compatible)').fill('ftp://bad');
  await expect(polishSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(polishSwitch).toBeEnabled();
  await polishSwitch.click();
  await expect(polishSwitch).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => page.evaluate(() => window.codevo.getSettings())).toMatchObject({ aiBaseUrl: 'http://127.0.0.1:9/v1', aiPolish: false });
});

test('polish sends the custom words, the instructions saved in Settings and the text around the cursor', async () => {
  const bodies: string[] = [];
  const baseUrl = await listen(createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'));
      outgoing.writeHead(200, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ id: 'chatcmpl-1', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'Prepis zo servera.' }, finish_reason: 'stop' }] }));
    });
  }));
  const instructions = 'Píš vykanie s veľkým V.';
  const context = { before: 'Dobrý deň, posielam podklady k projektu Kumiba. ', after: ' S pozdravom' };
  await start({ aiBaseUrl: baseUrl, aiModel: MODEL, aiPolish: true, customWords: [{ word: 'Kumiba', aliases: ['kumíba'] }] });
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  await section().getByLabel('Vlastné pokyny').fill(`  ${instructions}\n`);
  await section().getByRole('button', { name: 'Uložiť pokyny' }).click();
  await expect.poll(() => page.evaluate(() => window.codevo.getSettings().then((settings) => settings.aiInstructions))).toBe(instructions);
  await expect(section().getByRole('button', { name: 'Uložiť pokyny' })).toBeDisabled();
  await shoot('ai-settings-instructions.png');
  await launched().evaluate((_electron, value) => { (globalThis as unknown as Hooks).codevoE2e.helper.fieldContext = value; }, context);

  await pair();
  const { text } = await dictate();

  expect(bodies).toHaveLength(1);
  const [system, user] = (JSON.parse(bodies[0]!) as { messages: Array<{ role: string; content: string }> }).messages;
  expect(system!.content.endsWith(`\n${instructions}`)).toBe(true);
  expect(JSON.parse(user!.content)).toEqual({ transcript: RAW, preferredSpellings: ['Kumiba'], context });
  expect(text).toBe('Prepis zo servera.');
  expect(await launched().evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.contextReads)).toHaveLength(1);
});

test.describe('an endpoint that cannot polish', () => {
  test('a closed port inserts the raw transcript at once', async () => {
    const closed = createServer();
    const baseUrl = await listen(closed);
    await new Promise((resolve) => closed.close(resolve));
    servers.splice(servers.indexOf(closed), 1);
    await start({ aiBaseUrl: baseUrl, aiModel: MODEL, aiPolish: true });
    await pair();
    const { text, afterReleaseMs } = await dictate();
    expect(text).toBe(RAW);
    expect(afterReleaseMs).toBeLessThan(5_000);
  });

  test('a server that never answers inserts the raw transcript after the 8 s timeout', async () => {
    test.setTimeout(60_000);
    const baseUrl = await listen(createServer(() => undefined));
    await start({ aiBaseUrl: baseUrl, aiModel: MODEL, aiPolish: true });
    await pair();
    const { text, afterReleaseMs } = await dictate();
    expect(text).toBe(RAW);
    expect(afterReleaseMs).toBeGreaterThan(7_500);
    expect(afterReleaseMs).toBeLessThan(12_000);
  });
});

test.describe('Codex CLI that cannot polish', () => {
  test('a missing CLI inserts the raw transcript and says so', async () => {
    await startWithCodex(null);
    await pair();
    const { text, afterReleaseMs } = await dictate();
    expect(text).toBe(RAW);
    expect(afterReleaseMs).toBeLessThan(5_000);
    await overlayNotice('Codex CLI sa nenašiel. Nainštalujte ho alebo skontrolujte PATH.', 'overlay-codex-not-found.png');
  });

  test('a logged-out CLI inserts the raw transcript after the timeout and says so', async () => {
    const real = await findCodex();
    test.skip(real === null, 'requires the Codex CLI');
    test.setTimeout(60_000);
    await startWithCodex(real);
    await pair();
    const { text } = await dictate();
    expect(text).toBe(RAW);
    await overlayNotice('Codex CLI nie je prihlásený. Spustite `codex login`.', 'overlay-codex-logged-out.png');
  });
});

test('quitting during the Codex CLI check stops it and removes its private directory', async () => {
  const bin = test.info().outputPath('bin');
  const record = test.info().outputPath('record');
  await mkdir(bin, { recursive: true });
  await mkdir(record, { recursive: true });
  await writeFile(join(bin, 'codex'), `#!/usr/bin/env bash
[[ "$1" == login ]] && exit 0
while [[ $# -gt 0 ]]; do
  [[ "$1" == -C ]] && echo "$2" > "${record}/workdir"
  shift
done
sleep 60 &
echo "$!" > "${record}/descendant"
echo "$$" > "${record}/pid"
wait
`);
  await chmod(join(bin, 'codex'), 0o755);
  process.env['PATH'] = `${bin}:${originalEnv.PATH ?? ''}`;
  await start({ aiProvider: 'codex' });
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  await section().getByRole('button', { name: 'Overiť Codex CLI' }).click();
  await expect.poll(() => readFile(join(record, 'pid'), 'utf8').catch(() => '')).not.toBe('');
  const [pid, descendant] = await Promise.all(['pid', 'descendant'].map(async (file) => Number(await readFile(join(record, file), 'utf8'))));
  const workdir = (await readFile(join(record, 'workdir'), 'utf8')).trim();

  const closed = await Promise.race([launched().close().then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000))]);
  app = null;

  expect({ closed, child: isRunning(pid!), descendant: isRunning(descendant!) }).toEqual({ closed: true, child: false, descendant: false });
  await expect(stat(workdir)).rejects.toThrow();
});
