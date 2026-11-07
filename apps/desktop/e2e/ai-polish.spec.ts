import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { E2eHooks } from '../src/main/app/e2e-hooks';
import type { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import type { Settings } from '../src/shared/settings';
import { appWindows } from './app-windows';
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
  await launched.firstWindow();
  await expect.poll(() => appWindows(launched).length).toBeGreaterThan(0);
  page = appWindows(launched)[0]!;
  await page.waitForLoadState('domcontentloaded');
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
});

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
