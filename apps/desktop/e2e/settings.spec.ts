import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Settings } from '../src/shared/settings';
import { createUserDataDir, launchApp, removeUserDataDir } from './launch-app';

const DEFAULTS: Settings = {
  hotkey: null,
  mode: 'hold',
  language: 'sk',
  microphone: { deviceId: null, label: null },
  engineOrder: ['local'],
  localModelId: null,
  insertion: 'paste',
  overlay: 'indicator',
  launchAtLogin: false,
  onboardingDone: false,
};

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

async function start(): Promise<void> {
  app = await launchApp(userDataDir);
  page = await app.firstWindow();
}

test.beforeEach(async () => {
  userDataDir = await createUserDataDir();
  await start();
});

test.afterEach(async () => {
  await app.close();
  await removeUserDataDir(userDataDir);
});

test('runs as Codevo Whisper with the isolated user data directory', async () => {
  const identity = await app.evaluate(({ app: electronApp }) => ({ name: electronApp.getName(), userData: electronApp.getPath('userData') }));

  expect(identity).toEqual({ name: 'Codevo Whisper', userData: userDataDir });
});

test('exposes a frozen api with the default settings', async () => {
  const result = await page.evaluate(async () => ({ frozen: Object.isFrozen(window.codevo), settings: await window.codevo.getSettings() }));

  expect(result).toEqual({ frozen: true, settings: DEFAULTS });
});

test('persists an update across a relaunch', async () => {
  const updated = await page.evaluate(() => window.codevo.updateSettings({ mode: 'toggle', language: 'en' }));
  expect(updated).toEqual({ ...DEFAULTS, mode: 'toggle', language: 'en' });

  await app.close();
  await start();

  const onDisk = JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as unknown;
  expect(onDisk).toEqual({ ...DEFAULTS, mode: 'toggle', language: 'en' });
  expect(await page.evaluate(() => window.codevo.getSettings())).toEqual({ ...DEFAULTS, mode: 'toggle', language: 'en' });
});

test('rejects an invalid patch and keeps the settings', async () => {
  const outcome = await page.evaluate(async () => {
    const patch = JSON.parse('{"engineOrder":["server"]}') as Partial<Settings>;
    try {
      await window.codevo.updateSettings(patch);
      return 'accepted';
    } catch (error) {
      return String(error);
    }
  });

  expect(outcome).toContain('IpcValidationError');
  expect(await page.evaluate(() => window.codevo.getSettings())).toEqual(DEFAULTS);
});

test('notifies the renderer about settings changes', async () => {
  const received = await page.evaluate(
    () =>
      new Promise<Settings>((resolve) => {
        const unsubscribe = window.codevo.on('settings-changed', (settings) => {
          unsubscribe();
          resolve(settings);
        });
        void window.codevo.updateSettings({ overlay: 'live' });
      }),
  );

  expect(received).toEqual({ ...DEFAULTS, overlay: 'live' });
});
