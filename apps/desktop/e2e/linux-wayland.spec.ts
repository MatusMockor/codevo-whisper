import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createUserDataDir, launchApp, ONBOARDED, FAKE_MEDIA_ARGS } from './launch-app';
import type { E2eHooks } from '../src/main/app/e2e-hooks';

test('native Wayland uses a reduced regular window and copies through the real helper', async () => {
  test.skip(process.platform !== 'linux' || process.env['XDG_SESSION_TYPE'] !== 'wayland', 'requires actual GNOME Wayland verification preflight');
  const dir = await createUserDataDir(ONBOARDED);
  const app = await launchApp(dir, [...FAKE_MEDIA_ARGS, '--ozone-platform=wayland']);
  try {
    await app.firstWindow();
    await app.evaluate(() => { const hooks = (globalThis as unknown as { codevoE2e: E2eHooks }).codevoE2e; hooks.overlay.show({ kind: 'recording', elapsedMs: 2300, level: 0.4, language: 'SK', live: { confirmed: 'Text vo Waylande', tentative: 'pokračuje' } }); });
    await expect.poll(() => app.windows().some((p) => p.url().endsWith('/overlay/overlay.html'))).toBe(true);
    const overlay = app.windows().find((p) => p.url().endsWith('/overlay/overlay.html'))!;
    await expect(overlay.getByText('Text vo Waylande')).toBeVisible();
    const policy = await app.evaluate(({ BrowserWindow, app }) => { const panel = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/overlay/overlay.html'))!; return { focusable: panel.isFocusable(), topmost: panel.isAlwaysOnTop(), pid: panel.webContents.getOSProcessId(), noSandbox: app.commandLine.hasSwitch('no-sandbox') }; });
    expect(policy).toMatchObject({ focusable: true, topmost: false, noSandbox: false });
    const kernel = readFileSync(`/proc/${policy.pid}/status`, 'utf8');
    expect(kernel).toContain('NoNewPrivs:\t1'); expect(kernel).toContain('Seccomp:\t2'); expect(kernel).toContain('CapEff:\t0000000000000000');
    await app.evaluate(() => { const hooks = (globalThis as unknown as { codevoE2e: E2eHooks }).codevoE2e; hooks.lastTranscript.set('Wayland Copy Žilina 🚀'); hooks.overlay.show({ kind: 'blocked', reason: 'secure' }); });
    await overlay.getByRole('button', { name: 'Kopírovať', exact: true }).click();
    await expect.poll(() => app.evaluate(async ({ clipboard }) => clipboard.readText())).toBe('Wayland Copy Žilina 🚀');
  } finally { await app.close(); }
});
