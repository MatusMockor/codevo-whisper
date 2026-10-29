import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createUserDataDir, launchApp, ONBOARDED } from './launch-app';
import type { E2eHooks } from '../src/main/app/e2e-hooks';

test('managed X11 product overlay retains focus above normal and fullscreen targets and copies interactively', async () => {
  test.skip(process.platform !== 'linux' || process.env['XDG_SESSION_TYPE'] === 'wayland', 'requires an actual X11 desktop');
  const dir = await createUserDataDir(ONBOARDED);
  const app = await launchApp(dir);
  try {
    const main = await app.firstWindow();
    await main.waitForLoadState('domcontentloaded');
    const targetId = await app.evaluate(async ({ BrowserWindow }) => {
      const target = new BrowserWindow({ title: 'Codevo controlled overlay target', width: 500, height: 220, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await target.loadURL('data:text/html,<title>Codevo controlled overlay target</title><textarea autofocus aria-label="Target"></textarea>');
      target.show(); target.focus();
      return target.getNativeWindowHandle().readUInt32LE();
    });
    const xdo = (...args: string[]) => execFileSync('xdotool', args, { encoding: 'utf8' }).trim();
    xdo('windowactivate', '--sync', String(targetId));
    for (const fullscreen of [false, true]) {
      await app.evaluate(({ BrowserWindow }, full) => { BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Codevo controlled overlay target')?.setFullScreen(full); }, fullscreen);
      await app.evaluate(() => { const hooks = (globalThis as unknown as { codevoE2e: E2eHooks }).codevoE2e; hooks.overlay.show({ kind: 'recording', elapsedMs: 2000, level: 0.5, language: 'SK', live: { confirmed: 'Overený text', tentative: 'pokračuje' } }); });
      await expect.poll(() => app.windows().find((p) => p.url().endsWith('/overlay/overlay.html'))).toBeTruthy();
      const overlay = app.windows().find((p) => p.url().endsWith('/overlay/overlay.html'));
      expect(overlay).toBeTruthy();
      await expect(overlay!.getByText('Overený text')).toBeVisible();
      const state = await app.evaluate(({ BrowserWindow, app }) => {
        const panel = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/overlay/overlay.html'))!;
        return { xid: panel.getNativeWindowHandle().readUInt32LE(), focused: panel.isFocused(), focusable: panel.isFocusable(), pid: panel.webContents.getOSProcessId(), noSandbox: app.commandLine.hasSwitch('no-sandbox') };
      });
      await expect.poll(() => execFileSync('xprop', ['-id', String(state.xid), '_NET_WM_STATE'], { encoding: 'utf8' })).toContain('_NET_WM_STATE_ABOVE');
      await expect.poll(() => {
        const stack: string[] = execFileSync('xprop', ['-root', '_NET_CLIENT_LIST_STACKING'], { encoding: 'utf8' }).match(/0x[0-9a-f]+/g) ?? [];
        const target = stack.indexOf(`0x${targetId.toString(16)}`);
        return target >= 0 && stack.indexOf(`0x${state.xid.toString(16)}`) > target;
      }).toBe(true);
      expect(execFileSync('xwininfo', ['-id', String(state.xid), '-all'], { encoding: 'utf8' })).toContain('Override Redirect State: no');
      expect(xdo('getactivewindow')).toBe(String(targetId));
      expect(state.focusable).toBe(true); expect(state.focused).toBe(false); expect(state.noSandbox).toBe(false);
      const status = readFileSync(`/proc/${state.pid}/status`, 'utf8');
      expect(status).toContain('CapEff:\t0000000000000000'); expect(status).toContain('NoNewPrivs:\t1'); expect(status).toContain('Seccomp:\t2');
      xdo('type', 'overlay-focus');
      const typed: unknown = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Codevo controlled overlay target')!.webContents.executeJavaScript('document.querySelector("textarea").value'));
      expect(typed).toContain('overlay-focus');
      console.log(JSON.stringify({ fullscreen, ...state, above: true, managed: true, focusRetained: true, kernelSandbox: true }));
      await app.evaluate(() => { (globalThis as unknown as { codevoE2e: E2eHooks }).codevoE2e.overlay.show({ kind: 'hidden' }); });
    }
    await app.evaluate(() => { const hooks = (globalThis as unknown as { codevoE2e: E2eHooks }).codevoE2e; hooks.lastTranscript.set('Copy z overeného okna'); hooks.overlay.show({ kind: 'blocked', reason: 'focus' }); });
    const overlay = app.windows().find((p) => p.url().endsWith('/overlay/overlay.html'))!;
    await overlay.getByRole('button', { name: 'Kopírovať', exact: true }).click();
    await expect.poll(() => app.evaluate(async ({ clipboard }) => clipboard.readText())).toBe('Copy z overeného okna');
  } finally { await app.close(); }
});
