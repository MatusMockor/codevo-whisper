import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createUserDataDir, launchApp, ONBOARDED, FAKE_MEDIA_ARGS } from './launch-app';

test('Linux catalog model transcribes file-backed microphone capture through the real helper and engine', async () => {
  test.skip(process.platform !== 'linux' || !process.env['CW_NATIVE_AUDIO'], 'requires the declared native audio fixture');
  test.setTimeout(600_000);
  const dir = await createUserDataDir({ ...ONBOARDED, hotkey: { kind: 'key', keycode: 0x10060, modifiers: ['control'], label: 'Ctrl+F12' }, insertion: 'clipboard', localAcceleration: 'cpu', localModelUnload: 'immediately', language: 'en', mode: 'hold' });
  console.log(JSON.stringify({ userDataDir: dir, audio: process.env['CW_NATIVE_AUDIO'], fixture: 'Chromium file-backed microphone, native helper and catalog model' }));
  const app = await launchApp(dir, [...FAKE_MEDIA_ARGS, `--use-file-for-fake-audio-capture=${resolve(process.env['CW_NATIVE_AUDIO']!)}`]);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => window.codevo.downloadModel('parakeet-ultra-q4'));
    await expect.poll(() => page.evaluate(() => window.codevo.getModelStates()), { timeout: 480_000, intervals: [500, 1000, 2000] }).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'parakeet-ultra-q4', status: 'ready' })]));
    await page.evaluate(() => window.codevo.activateModel('parakeet-ultra-q4'));
    await expect.poll(() => page.evaluate(() => window.codevo.getStatus()), { timeout: 120_000 }).toMatchObject({ modelReady: true });
    await expect.poll(() => page.evaluate(() => window.codevo.isHotkeyArmed())).toBe(true);
    execFileSync('xdotool', ['keydown', 'Control_L']);
    execFileSync('xdotool', ['keydown', 'F12']);
    await expect.poll(() => app.windows().some((window) => window.url().endsWith('/overlay/overlay.html'))).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 6500));
    execFileSync('xdotool', ['keyup', 'F12']);
    execFileSync('xdotool', ['keyup', 'Control_L']);
    await expect.poll(() => page.evaluate(() => window.codevo.getLastTranscript()), { timeout: 120_000 }).toEqual(expect.any(String));
    const transcript = await page.evaluate(() => window.codevo.getLastTranscript());
    expect(transcript?.length).toBeGreaterThan(0);
    await expect.poll(() => app.evaluate(async ({ clipboard }) => clipboard.readText())).toBe(transcript);
    console.log(JSON.stringify({ catalogModel: 'parakeet-ultra-q4', capture: 'file-backed Chromium microphone', nativeHelper: true, engine: 'CPU resident', transcript }));
  } finally {
    execFileSync('xdotool', ['keyup', 'F12', 'Control_L']);
    await app.close();
  }
});
