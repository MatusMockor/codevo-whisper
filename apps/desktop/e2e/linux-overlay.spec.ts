import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ElectronApplication, Page } from '@playwright/test';
import type { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import { startLocalGateway, type LocalGateway } from './local-gateway';
import { mainWindow } from './app-windows';
import { createUserDataDir, FAKE_MEDIA_ARGS, launchApp, ONBOARDED } from './launch-app';
import type { E2eHooks } from '../src/main/app/e2e-hooks';

type Hooks = { codevoE2e: E2eHooks & { helper: FakeInputHelper } };
const TARGET = 'Codevo controlled overlay target';
const xdo = (...args: string[]) => execFileSync('xdotool', args, { encoding: 'utf8' }).trim();

async function pointAt(app: ElectronApplication, overlay: Page, selector: string): Promise<[number, number]> {
  const rect = await overlay.locator(selector).evaluate((element) => { const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/overlay/overlay.html'))!.getContentBounds());
  return [Math.round(bounds.x + rect.x), Math.round(bounds.y + rect.y)];
}

async function openTarget(app: ElectronApplication): Promise<number> {
  const targetId = await app.evaluate(async ({ BrowserWindow }, title) => {
    const target = new BrowserWindow({ title, width: 500, height: 220, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await target.loadURL(`data:text/html,<title>${title}</title><textarea autofocus aria-label="Target"></textarea>`);
    target.show(); target.focus();
    return target.getNativeWindowHandle().readUInt32LE();
  }, TARGET);
  xdo('windowactivate', '--sync', String(targetId));
  return targetId;
}

async function pairServer(page: Page): Promise<LocalGateway> {
  const gateway = await startLocalGateway();
  const pairing = await gateway.openPairingWindow();
  await page.evaluate((token) => window.codevo.pairServer(token), pairing.token);
  await pairing.admin.next();
  pairing.admin.send({ decision: 'approve' });
  await pairing.admin.next();
  pairing.admin.close();
  await expect.poll(() => page.evaluate(() => window.codevo.getServer().then((view) => view.server?.status.kind))).toBe('online');
  await page.evaluate(() => window.codevo.updateSettings({ engineOrder: ['server'] }));
  await expect.poll(() => page.evaluate(() => window.codevo.isHotkeyArmed())).toBe(true);
  return gateway;
}

async function polishingServer(polished: string): Promise<{ baseUrl: string; requests: string[]; close(): Promise<void> }> {
  const requests: string[] = [];
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      requests.push(Buffer.concat(chunks).toString('utf8'));
      outgoing.writeHead(200, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: polished }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    requests,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

function targetEval(app: ElectronApplication, script: string): Promise<unknown> {
  return app.evaluate(({ BrowserWindow }, [title, code]) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === title)!.webContents.executeJavaScript(code), [TARGET, script] as const);
}

function targetText(app: ElectronApplication): Promise<unknown> {
  return app.evaluate(({ BrowserWindow }, title) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === title)!.webContents.executeJavaScript('document.querySelector("textarea").value'), TARGET);
}

test('X11 product overlay takes clicks above normal and fullscreen targets without taking focus and copies interactively', async () => {
  test.skip(process.platform !== 'linux' || process.env['XDG_SESSION_TYPE'] === 'wayland', 'requires an actual X11 desktop');
  const dir = await createUserDataDir(ONBOARDED);
  const app = await launchApp(dir);
  try {
    await mainWindow(app);
    const targetId = await openTarget(app);
    for (const fullscreen of [false, true]) {
      await app.evaluate(({ BrowserWindow }, full) => { BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Codevo controlled overlay target')?.setFullScreen(full); }, fullscreen);
      xdo('windowactivate', '--sync', String(targetId));
      await app.evaluate(() => { const hooks = (globalThis as unknown as { codevoE2e: E2eHooks }).codevoE2e; hooks.overlay.show({ kind: 'recording', elapsedMs: 2000, level: 0.5, languageChip: 'SK +2', live: { confirmed: 'Overený text', tentative: 'pokračuje' } }); });
      await expect.poll(() => app.windows().find((p) => p.url().endsWith('/overlay/overlay.html'))).toBeTruthy();
      const overlay = app.windows().find((p) => p.url().endsWith('/overlay/overlay.html'));
      expect(overlay).toBeTruthy();
      await expect(overlay!.getByText('Overený text')).toBeVisible();
      await expect(overlay!.locator('.chip')).toHaveText('SK +2');
      const state = await app.evaluate(({ BrowserWindow, app }) => {
        const panel = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/overlay/overlay.html'))!;
        return { xid: panel.getNativeWindowHandle().readUInt32LE(), focused: panel.isFocused(), focusable: panel.isFocusable(), pid: panel.webContents.getOSProcessId(), noSandbox: app.commandLine.hasSwitch('no-sandbox') };
      });
      expect(xdo('getactivewindow')).toBe(String(targetId));
      expect(state.focusable).toBe(false); expect(state.focused).toBe(false); expect(state.noSandbox).toBe(false);
      const status = readFileSync(`/proc/${state.pid}/status`, 'utf8');
      expect(status).toContain('CapEff:\t0000000000000000'); expect(status).toContain('NoNewPrivs:\t1'); expect(status).toContain('Seccomp:\t2');
      xdo('windowraise', String(targetId));
      xdo('windowactivate', '--sync', String(targetId));
      await overlay!.evaluate(() => { document.addEventListener('pointerdown', () => { document.body.dataset['clicked'] = 'yes'; }, { once: true }); });
      const [x, y] = await pointAt(app, overlay!, '.chip');
      xdo('mousemove', String(x), String(y), 'click', '1');
      await expect.poll(() => overlay!.evaluate(() => document.body.dataset['clicked'])).toBe('yes');
      expect(xdo('getactivewindow')).toBe(String(targetId));
      xdo('type', 'overlay-focus');
      expect(await targetText(app)).toContain('overlay-focus');
      console.log(JSON.stringify({ fullscreen, ...state, clickedAbove: true, focusRetained: true, kernelSandbox: true }));
      await app.evaluate(() => { (globalThis as unknown as { codevoE2e: E2eHooks }).codevoE2e.overlay.show({ kind: 'hidden' }); });
    }
    await app.evaluate(() => { const hooks = (globalThis as unknown as { codevoE2e: E2eHooks }).codevoE2e; hooks.lastTranscript.set('Copy z overeného okna'); hooks.overlay.show({ kind: 'blocked', reason: 'focus' }); });
    const overlay = app.windows().find((p) => p.url().endsWith('/overlay/overlay.html'))!;
    await overlay.getByRole('button', { name: 'Kopírovať', exact: true }).click();
    await expect.poll(() => app.evaluate(async ({ clipboard }) => clipboard.readText())).toBe('Copy z overeného okna');
  } finally { await app.close(); }
});

test('X11 overlay cancel button discards a live dictation and the target keeps focus', async () => {
  test.skip(process.platform !== 'linux' || process.env['XDG_SESSION_TYPE'] === 'wayland', 'requires an actual X11 desktop');
  const dir = await createUserDataDir({ ...ONBOARDED, hotkey: { kind: 'modifiers', keycodes: [63], label: 'Fn' }, mode: 'toggle' });
  const app = await launchApp(dir, FAKE_MEDIA_ARGS, { fakeHelper: true });
  let gateway: LocalGateway | null = null;
  try {
    const page = await mainWindow(app);
    gateway = await pairServer(page);
    const targetId = await openTarget(app);

    await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.emitHotkey('down'));
    await expect.poll(() => app.windows().some((p) => p.url().endsWith('/overlay/overlay.html'))).toBe(true);
    const overlay = app.windows().find((p) => p.url().endsWith('/overlay/overlay.html'))!;
    const cancel = overlay.getByRole('button', { name: 'Zrušiť diktovanie (Esc)' });
    await expect(cancel).toBeVisible();
    expect(await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.sessionShortcuts)).toEqual([
      { action: 'cancel', key: 'escape', modifiers: [] },
      { action: 'lock-target', key: 'l', modifiers: ['control', 'shift'] },
      { action: 'cycle-language', key: 'j', modifiers: ['control', 'alt'] },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 600));

    const [x, y] = await pointAt(app, overlay, '.ov-ctl');
    xdo('mousemove', String(x), String(y), 'click', '1');

    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/overlay/overlay.html'))!.isVisible())).toBe(false);
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.sessionShortcuts)).toEqual([]);
    expect(xdo('getactivewindow')).toBe(String(targetId));
    xdo('type', 'still-here');
    expect(await targetText(app)).toBe('still-here');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.pasted)).toEqual([]);
    expect(await page.evaluate(() => window.codevo.getLastTranscript())).toBeNull();
    expect(await page.evaluate(() => window.codevo.getStats())).toEqual([]);
    console.log(JSON.stringify({ cancelledByClick: true, targetActive: true, inserted: false }));
  } finally {
    await app.close();
    await gateway?.close();
  }
});

test('X11 Esc from the real keyboard path discards a live dictation and never reaches the target', async () => {
  test.skip(process.platform !== 'linux' || process.env['XDG_SESSION_TYPE'] === 'wayland', 'requires an actual X11 desktop');
  const dir = await createUserDataDir({ ...ONBOARDED, hotkey: { kind: 'key', keycode: 0x10060, modifiers: ['control'], label: 'Ctrl+F12' }, mode: 'toggle', insertion: 'clipboard' });
  const app = await launchApp(dir);
  let gateway: LocalGateway | null = null;
  try {
    const page = await mainWindow(app);
    gateway = await pairServer(page);
    await openTarget(app);
    await app.evaluate(({ BrowserWindow }, title) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === title)!.webContents.executeJavaScript('window.escapes = 0; document.addEventListener("keydown", (e) => { if (e.key === "Escape") window.escapes++; })'), TARGET);
    xdo('key', 'Escape');
    await expect.poll(() => app.evaluate(({ BrowserWindow }, title) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === title)!.webContents.executeJavaScript('window.escapes'), TARGET)).toBe(1);
    const clipboardBefore = await app.evaluate(({ clipboard }) => clipboard.readText());

    xdo('key', 'ctrl+F12');
    await expect.poll(() => app.windows().some((p) => p.url().endsWith('/overlay/overlay.html'))).toBe(true);
    const overlay = app.windows().find((p) => p.url().endsWith('/overlay/overlay.html'))!;
    await expect(overlay.getByRole('status', { name: 'Nahrávam' })).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 800));
    xdo('key', 'Escape');

    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/overlay/overlay.html'))!.isVisible())).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await app.evaluate(({ BrowserWindow }, title) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === title)!.webContents.executeJavaScript('window.escapes'), TARGET)).toBe(1);
    expect(await page.evaluate(() => window.codevo.getLastTranscript())).toBeNull();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(clipboardBefore);
    xdo('key', 'Escape');
    await expect.poll(() => app.evaluate(({ BrowserWindow }, title) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === title)!.webContents.executeJavaScript('window.escapes'), TARGET)).toBe(2);
    console.log(JSON.stringify({ cancelledByEsc: true, escConsumedWhileDictating: true, escReleasedAfter: true }));
  } finally {
    await app.close();
    await gateway?.close();
  }
});

test('X11 AI and language chips flip one dictation by click, keep the target focused and polish the text per the chip', async () => {
  test.skip(process.platform !== 'linux' || process.env['XDG_SESSION_TYPE'] === 'wayland', 'requires an actual X11 desktop');
  const llm = await polishingServer('Upravený prepis.');
  const dir = await createUserDataDir({ ...ONBOARDED, hotkey: { kind: 'modifiers', keycodes: [63], label: 'Fn' }, mode: 'toggle', aiBaseUrl: llm.baseUrl, aiModel: 'test-model', aiPolish: false });
  const app = await launchApp(dir, FAKE_MEDIA_ARGS, { fakeHelper: true });
  let gateway: LocalGateway | null = null;
  try {
    const page = await mainWindow(app);
    gateway = await pairServer(page);
    const targetId = await openTarget(app);

    await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.emitHotkey('down'));
    await expect.poll(() => app.windows().some((p) => p.url().endsWith('/overlay/overlay.html'))).toBe(true);
    const overlay = app.windows().find((p) => p.url().endsWith('/overlay/overlay.html'))!;
    await expect(overlay.locator('.ov-lock')).toHaveCount(0);
    await expect(overlay.getByRole('button', { name: 'AI úprava vypnutá' })).toBeVisible();
    await expect(overlay.getByRole('button', { name: 'Jazyk diktovania: AUTO' })).toBeVisible();
    expect(await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.sessionShortcuts.map(({ action }) => action))).toEqual(['cancel', 'lock-target', 'toggle-polish', 'cycle-language']);
    await new Promise((resolve) => setTimeout(resolve, 600));

    const [aiX, aiY] = await pointAt(app, overlay, 'button[aria-label^="AI úprava"]');
    xdo('mousemove', String(aiX), String(aiY), 'click', '1');
    await expect(overlay.getByRole('button', { name: 'AI úprava zapnutá' })).toBeVisible();
    const [langX, langY] = await pointAt(app, overlay, 'button[aria-label^="Jazyk diktovania"]');
    xdo('mousemove', String(langX), String(langY), 'click', '1');
    await expect(overlay.getByRole('button', { name: 'Jazyk diktovania: SK' })).toBeVisible();
    xdo('mousemove', String(langX), String(langY), 'click', '1');
    await expect(overlay.getByRole('button', { name: 'Jazyk diktovania: AUTO' })).toBeVisible();
    expect(xdo('getactivewindow')).toBe(String(targetId));
    await overlay.screenshot({ path: test.info().outputPath('x11-chips-recording.png') });

    await app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.emitHotkey('down'));
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.pasted), { timeout: 30_000 }).toEqual(['Upravený prepis.']);
    expect(llm.requests).toHaveLength(1);
    expect(await page.evaluate(() => window.codevo.getSettings().then((settings) => [settings.aiPolish, settings.languages]))).toEqual([false, { mode: 'auto', selected: ['sk'] }]);
    expect(xdo('getactivewindow')).toBe(String(targetId));
    console.log(JSON.stringify({ aiChipClicked: true, languageChipCycled: ['AUTO', 'SK', 'AUTO'], targetActive: true, polishedPerChip: true, settingUnchanged: true }));
  } finally {
    await app.close();
    await gateway?.close();
    await llm.close();
  }
});

test('X11 Ctrl+Alt+J from the real keyboard cycles the language while dictating and never reaches the target', async () => {
  test.skip(process.platform !== 'linux' || process.env['XDG_SESSION_TYPE'] === 'wayland', 'requires an actual X11 desktop');
  const dir = await createUserDataDir({ ...ONBOARDED, hotkey: { kind: 'key', keycode: 0x10060, modifiers: ['control'], label: 'Ctrl+F12' }, mode: 'toggle', insertion: 'clipboard', languages: { mode: 'auto', selected: ['sk', 'cs'] } });
  const app = await launchApp(dir);
  let gateway: LocalGateway | null = null;
  try {
    const page = await mainWindow(app);
    gateway = await pairServer(page);
    await openTarget(app);
    await targetEval(app, 'window.chords = 0; document.addEventListener("keydown", (e) => { if (e.code === "KeyJ" && e.ctrlKey && e.altKey) window.chords++; })');
    xdo('key', 'ctrl+alt+j');
    await expect.poll(() => targetEval(app, 'window.chords')).toBe(1);

    xdo('key', 'ctrl+F12');
    await expect.poll(() => app.windows().some((p) => p.url().endsWith('/overlay/overlay.html'))).toBe(true);
    const overlay = app.windows().find((p) => p.url().endsWith('/overlay/overlay.html'))!;
    await expect(overlay.getByRole('button', { name: 'Jazyk diktovania: AUTO' })).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 800));
    xdo('key', 'ctrl+alt+j');
    await expect(overlay.getByRole('button', { name: 'Jazyk diktovania: SK' })).toBeVisible();
    xdo('key', 'ctrl+alt+j');
    await expect(overlay.getByRole('button', { name: 'Jazyk diktovania: CS' })).toBeVisible();
    xdo('key', 'Escape');

    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/overlay/overlay.html'))!.isVisible())).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await targetEval(app, 'window.chords')).toBe(1);
    expect(await page.evaluate(() => window.codevo.getSettings().then((settings) => settings.languages))).toEqual({ mode: 'auto', selected: ['sk', 'cs'] });
    xdo('key', 'ctrl+alt+j');
    await expect.poll(() => targetEval(app, 'window.chords')).toBe(2);
    console.log(JSON.stringify({ cycledByKeyboard: ['AUTO', 'SK', 'CS'], consumedWhileDictating: true, releasedAfter: true }));
  } finally {
    await app.close();
    await gateway?.close();
  }
});
