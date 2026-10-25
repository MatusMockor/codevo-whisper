import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Settings } from '../src/shared/settings';
import { createUserDataDir, FAKE_MEDIA_ARGS, launchApp, ONBOARDED, removeUserDataDir } from './launch-app';

type FakeHelperGlobal = { codevoE2e: { helper: { recordedKey: number | null } } };

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
  app = await launchApp(userDataDir, FAKE_MEDIA_ARGS, { fakeHelper: true });
  page = await app.firstWindow();
}

test.afterEach(async () => {
  await app.close();
  await removeUserDataDir(userDataDir);
});

test.describe('settings api', () => {
  test.beforeEach(async () => {
    userDataDir = await createUserDataDir();
    await start();
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
      const patch = JSON.parse('{"engineOrder":["server","server"]}') as Partial<Settings>;
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
          void window.codevo.updateSettings({ mode: 'toggle' });
        }),
    );

    expect(received).toEqual({ ...DEFAULTS, mode: 'toggle' });
  });

  test('starts with defaults when the settings file cannot be read', async () => {
    await app.close();
    await mkdir(join(userDataDir, 'settings.json'));
    await start();

    await expect(page).toHaveTitle('Codevo Whisper');
    expect(app.windows()).toHaveLength(1);
    expect(await page.evaluate(() => window.codevo.getSettings())).toEqual(DEFAULTS);
  });

  test('rejects subscriptions to unknown events or without a listener', async () => {
    const outcome = await page.evaluate(() => {
      const attempt = (run: () => unknown): string => {
        try {
          run();
          return 'accepted';
        } catch (error) {
          return String(error);
        }
      };
      const loose = window.codevo as unknown as { on: (event: unknown, listener: unknown) => unknown };
      return {
        unknownEvent: attempt(() => loose.on('toString', () => undefined)),
        missingListener: attempt(() => loose.on('settings-changed', 'not a function')),
      };
    });

    expect(outcome.unknownEvent).toContain('Unknown event');
    expect(outcome.missingListener).toContain('Listener must be a function');
  });
});

function row(title: string): Locator {
  return page.locator('.srow', { has: page.locator('b', { hasText: title }) });
}

async function openSettings(): Promise<void> {
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nastavenia');
}

function levelWithin(ms: number): Promise<boolean> {
  return page.evaluate(
    (timeout) =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          stop();
          resolve(false);
        }, timeout);
        const stop = window.codevo.on('microphone-level', () => {
          clearTimeout(timer);
          stop();
          resolve(true);
        });
      }),
    ms,
  );
}

function mainWindow(action: 'hide' | 'showInactive' | 'minimize' | 'restore'): Promise<void> {
  return app.evaluate(({ BrowserWindow }, name) => {
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().endsWith('/renderer/index.html'))
      ?.[name]();
  }, action);
}

function setRecordedKey(keycode: number): Promise<void> {
  return app.evaluate((_electron, key) => {
    (globalThis as unknown as FakeHelperGlobal).codevoE2e.helper.recordedKey = key;
  }, keycode);
}

test.describe('settings page', () => {
  test.beforeEach(async () => {
    userDataDir = await createUserDataDir(ONBOARDED);
    await start();
    await openSettings();
  });

  test('changes to Režim, Jazyk, Vkladanie and Spustiť po prihlásení persist across a relaunch', async () => {
    await page.getByRole('group', { name: 'Režim klávesu' }).getByRole('button', { name: 'Prepínanie' }).click();
    await expect(row('Režim')).toContainText('Prvé stlačenie začne nahrávať, druhé ukončí.');
    await row('Jazyk').getByRole('combobox').selectOption('en');
    await page.getByRole('radio', { name: /Iba skopírovať do schránky/ }).click();
    await expect(page.getByRole('radio', { name: /Iba skopírovať do schránky/ })).toBeChecked();
    await page.getByRole('switch', { name: 'Spustiť po prihlásení' }).click();
    await expect(page.getByRole('switch', { name: 'Spustiť po prihlásení' })).toHaveAttribute('aria-checked', 'true');

    await expect.poll(async () => JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as Settings).toMatchObject({
      mode: 'toggle',
      language: 'en',
      insertion: 'clipboard',
      launchAtLogin: true,
    });
    await app.close();
    await start();
    await openSettings();

    await expect(page.getByRole('group', { name: 'Režim klávesu' }).getByRole('button', { name: 'Prepínanie' })).toHaveAttribute('aria-pressed', 'true');
    await expect(row('Jazyk').getByRole('combobox')).toHaveValue('en');
    await expect(page.getByRole('radio', { name: /Iba skopírovať do schránky/ })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Spustiť po prihlásení' })).toHaveAttribute('aria-checked', 'true');
  });

  test('the hotkey recorder shows the recorded key and explains an unsupported one', async () => {
    const recorder = row('Klávesová skratka').locator('.hk');
    await expect(recorder).toContainText('Nenastavená');

    await setRecordedKey(62);
    await recorder.click();

    await expect(recorder).toContainText('Pravý ⌃ Control');
    await expect.poll(() => page.evaluate(() => window.codevo.getSettings().then((settings) => settings.hotkey))).toEqual({ keycode: 62, label: 'Pravý ⌃ Control' });

    await setRecordedKey(0);
    await recorder.click();
    await expect(row('Klávesová skratka').getByRole('alert')).toContainText('Tento kláves sa nedá použiť.');
    await expect(recorder).toContainText('Pravý ⌃ Control');
  });

  test('the server engine orders and Živý text are visible but disabled with a note', async () => {
    const engine = page.getByRole('radiogroup', { name: 'Kde beží prepis' });
    await expect(engine.getByRole('radio')).toHaveCount(4);
    await expect(engine.getByRole('radio', { name: /^Lokálne/ }).first()).toBeChecked();
    await expect(engine.getByRole('radio', { name: /^Server/ }).first()).toBeDisabled();
    await expect(page.getByText('Najprv spárujte server na stránke Server.')).toBeVisible();

    const overlay = page.getByRole('group', { name: 'Zobrazenie panela' });
    await expect(overlay.getByRole('button', { name: 'Indikátor' })).toHaveAttribute('aria-pressed', 'true');
    await expect(overlay.getByRole('button', { name: 'Živý text' })).toBeDisabled();
    await expect(row('Zobrazenie panela')).toContainText('Príde v ďalšej verzii');
  });

  test('the model list shows the catalog with roles, sizes and downloads nothing by itself', async () => {
    const models = page.getByRole('list', { name: 'Modely na prepis' });
    const expected = [
      ['parakeet-ultra-q8', 'Parakeet Ultra', 'Odporúčaný', '740 MB'],
      ['canary-1b-v2-q8', 'Canary 1B v2', 'Najpresnejší pre slovenčinu a češtinu', '1,1 GB'],
      ['parakeet-ultra-q4', 'Parakeet Ultra (malý)', 'Pre slabší počítač', '486 MB'],
      ['tc-whisper-turbo-q8', 'Whisper Large v3 Turbo', 'Pre ďalšie jazyky', '886 MB'],
    ] as const;
    await expect(models.getByRole('listitem')).toHaveCount(expected.length);
    for (const [id, name, role, size] of expected) {
      const item = models.locator(`[data-model="${id}"]`);
      await expect(item).toContainText(name);
      await expect(item).toContainText(role);
      await expect(item).toContainText(size);
      await expect(item).toContainText('Nestiahnutý');
      await expect(item.getByRole('button', { name: `Stiahnuť: ${name}` })).toBeEnabled();
    }
    await expect(models.locator('[data-model="tc-whisper-turbo-q8"]')).toContainText('Licencia MIT');
    await expect(stat(join(userDataDir, 'models'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('the microphone picker lists the system default and shows a live level', async () => {
    const select = row('Vstup').getByRole('combobox');
    await expect(select.locator('option').first()).toHaveText('Systémový predvolený');
    await expect(select).toHaveValue('system-default');
    await expect.poll(() => select.locator('option').count()).toBeGreaterThan(1);
    const heard = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const stop = window.codevo.on('microphone-level', (rms) => {
            if (rms <= 0) {
              return;
            }
            stop();
            resolve(true);
          });
        }),
    );
    expect(heard).toBe(true);
    await expect(page.getByRole('meter', { name: 'Úroveň mikrofónu' })).toBeVisible();

    const device = await select.locator('option').nth(1).getAttribute('value');
    await select.selectOption(device ?? '');
    await expect.poll(() => page.evaluate(() => window.codevo.getSettings().then((settings) => settings.microphone.deviceId))).toBe(device);
  });

  test('the meter releases the microphone while the main window is hidden or minimized', async () => {
    await expect.poll(() => levelWithin(1500)).toBe(true);

    await mainWindow('hide');
    await page.waitForTimeout(300);
    expect(await levelWithin(1500)).toBe(false);
    await mainWindow('showInactive');
    await expect.poll(() => levelWithin(1500)).toBe(true);

    await mainWindow('minimize');
    await page.waitForTimeout(300);
    expect(await levelWithin(1500)).toBe(false);
    await mainWindow('restore');
    await expect.poll(() => levelWithin(1500)).toBe(true);
  });

  test('a setting that cannot be saved shows an inline error', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('settings:update');
      ipcMain.handle('settings:update', () => Promise.reject(new Error('disk full')));
    });

    await page.getByRole('group', { name: 'Režim klávesu' }).getByRole('button', { name: 'Prepínanie' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Zmenu sa nepodarilo uložiť.' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Režim klávesu' }).getByRole('button', { name: 'Podrž klávesu' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('Vynulovať štatistiky deletes the statistics after a confirmation', async () => {
    await app.close();
    await writeFile(join(userDataDir, 'stats.json'), JSON.stringify({ version: 1, days: [{ date: '2026-10-25', words: 12, dictations: 1, seconds: 6 }] }));
    await start();
    await openSettings();

    await page.getByRole('button', { name: 'Vynulovať štatistiky' }).click();
    await expect(row('Štatistiky')).toContainText('Táto akcia sa nedá vrátiť.');
    await page.getByRole('button', { name: 'Áno, vynulovať' }).click();

    await expect(row('Štatistiky')).toContainText('Štatistiky sú vynulované.');
    await expect(stat(join(userDataDir, 'stats.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('clickable elements show a pointer and a hover tint, disabled ones do not', async () => {
    const cursor = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).cursor);
    const background = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).backgroundColor);
    const tab = page.getByRole('tab', { name: 'Domov' });
    const button = page.getByRole('button', { name: 'Vynulovať štatistiky' });
    const segment = page.getByRole('group', { name: 'Režim klávesu' }).getByRole('button', { name: 'Prepínanie' });
    const disabled = page.getByRole('group', { name: 'Zobrazenie panela' }).getByRole('button', { name: 'Živý text' });

    expect(await cursor(tab)).toBe('pointer');
    expect(await cursor(button)).toBe('pointer');
    expect(await cursor(segment)).toBe('pointer');
    expect(await cursor(page.getByRole('switch', { name: 'Spustiť po prihlásení' }))).toBe('pointer');
    expect(await cursor(disabled)).not.toBe('pointer');

    for (const target of [tab, button, segment]) {
      const resting = await background(target);
      await target.hover();
      await expect.poll(() => background(target)).not.toBe(resting);
    }
    const restingDisabled = await background(disabled);
    await disabled.hover({ force: true });
    expect(await background(disabled)).toBe(restingDisabled);
  });
});
