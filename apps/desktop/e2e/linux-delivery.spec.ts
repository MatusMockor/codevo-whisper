import { expect, test } from '@playwright/test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createUserDataDir, launchApp, ONBOARDED, FAKE_MEDIA_ARGS } from './launch-app';
import type { E2eHooks } from '../src/main/app/e2e-hooks';

test('built Linux app pastes native dictation and replays through the native shortcut into a GTK target', async () => {
  test.skip(process.platform !== 'linux' || !process.env['CW_NATIVE_AUDIO'] || !process.env['CW_NATIVE_MODEL'], 'requires the declared catalog model and file-backed audio fixture');
  test.setTimeout(180_000);
  const dir = await createUserDataDir({ ...ONBOARDED, hotkey: { kind: 'key', keycode: 0x10060, modifiers: ['control'], label: 'Ctrl+F12' }, insertion: 'paste', clipboardPolicy: 'restore', localAcceleration: 'cpu', localModelId: 'parakeet-ultra-q4', localModelUnload: 'immediately', language: 'en', mode: 'hold' });
  await mkdir(join(dir, 'models'));
  await copyFile(process.env['CW_NATIVE_MODEL']!, join(dir, 'models', 'parakeet-ultra-q4.gguf'));
  const original = spawnSync('xdotool', ['getactivewindow'], { encoding: 'utf8' }).stdout?.trim() ?? '';
  const target = spawn('/usr/bin/python3', [resolve('../../native/linux-helper/test/desktop.py'), '--target'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: target.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  const first: unknown = JSON.parse((await iterator.next()).value ?? 'null');
  if (typeof first !== 'object' || first === null || !('windowId' in first) || typeof first.windowId !== 'number') throw new Error('native target did not expose its X11 window');
  const xid = String(first.windowId);
  const command = async (cmd: string) => { target.stdin.write(JSON.stringify({ cmd }) + '\n'); const response: unknown = JSON.parse((await iterator.next()).value ?? 'null'); return response; };
  const app = await launchApp(dir, [...FAKE_MEDIA_ARGS, `--use-file-for-fake-audio-capture=${resolve(process.env['CW_NATIVE_AUDIO']!)}`]);
  const xdo = (...args: string[]) => execFileSync('xdotool', args);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const security = await app.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('index.html'))!;
      const pid = window.webContents.getOSProcessId();
      return { pid, metricSandboxed: app.getAppMetrics().find((metric) => metric.pid === pid)?.sandboxed ?? null, noSandbox: app.commandLine.hasSwitch('no-sandbox') };
    });
    expect(security.noSandbox).toBe(false);
    const preloadBridge = await page.evaluate(() => ({ available: typeof window.codevo.getStatus === 'function', nodeProcess: 'process' in window, nodeRequire: 'require' in window }));
    expect(preloadBridge).toEqual({ available: true, nodeProcess: false, nodeRequire: false });
    const kernel = readFileSync(`/proc/${security.pid}/status`, 'utf8');
    expect(kernel).toContain('CapEff:\t0000000000000000'); expect(kernel).toContain('NoNewPrivs:\t1'); expect(kernel).toContain('Seccomp:\t2');
    console.log(JSON.stringify({ rendererSecurity: security, preloadBridge, kernelSandbox: true }));
    await expect.poll(() => page.evaluate(() => window.codevo.getStatus()), { timeout: 120_000 }).toMatchObject({ modelReady: true });
    await expect.poll(() => page.evaluate(() => window.codevo.isHotkeyArmed())).toBe(true);
    await app.evaluate(({ clipboard }) => clipboard.writeText('original clipboard'));
    xdo('windowactivate', '--sync', xid);
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { codevoE2e: E2eHooks }).codevoE2e.helper.focusedElement())).toMatchObject({ editable: true });
    xdo('keydown', 'Control_L'); xdo('keydown', 'F12');
    await new Promise((resolve) => setTimeout(resolve, 6500));
    xdo('keyup', 'F12'); xdo('keyup', 'Control_L');
    await expect.poll(() => page.evaluate(() => window.codevo.getLastTranscript()), { timeout: 120_000 }).toEqual(expect.any(String));
    const transcript = await page.evaluate(() => window.codevo.getLastTranscript());
    expect(transcript?.length).toBeGreaterThan(0);
    await expect.poll(() => command('text'), { timeout: 15_000 }).toEqual({ texts: [transcript, '', ''] });
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('original clipboard');
    await command('clear');
    await app.evaluate(() => (globalThis as unknown as { codevoE2e: E2eHooks }).codevoE2e.lastTranscript.set('Replay Žilina 🚀'));
    xdo('windowactivate', '--sync', xid); xdo('key', 'ctrl+super+v');
    await expect.poll(() => command('text')).toEqual({ texts: ['Replay Žilina 🚀', '', ''] });
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('original clipboard');
    expect(execFileSync('xdotool', ['getactivewindow'], { encoding: 'utf8' }).trim()).toBe(xid);
    console.log(JSON.stringify({ automaticPasteConsumed: true, nativeShortcutReplayConsumed: true, clipboardRestored: true, fixture: 'catalog Q4, CPU resident, Chromium file-backed audio, native helper and GTK target' }));
  } finally {
    xdo('keyup', 'F12', 'Control_L', 'Super_L', 'v');
    await app.close(); target.stdin.end(); await new Promise<void>((resolve) => target.once('close', () => resolve())); lines.close();
    if (original) xdo('windowactivate', original);
  }
});
