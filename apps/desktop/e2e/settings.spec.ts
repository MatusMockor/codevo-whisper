import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { appWindows } from './app-windows';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import type { LastTranscript } from '../src/main/insertion/last-transcript';
import type { HotkeyRecordResult } from '../src/shared/hotkey-record';
import type { Settings } from '../src/shared/settings';
import { createUserDataDir, FAKE_MEDIA_ARGS, launchApp, ONBOARDED, removeUserDataDir } from './launch-app';

type FakeHelperGlobal = { codevoE2e: { helper: FakeInputHelper; lastTranscript: Pick<LastTranscript, 'set'> } };

const DEFAULTS: Settings = {
  muteWhileRecording: false,
  audioFeedback: false,
  feedbackOutputId: null,
  feedbackVolume: 50,
  customWords: [],
  removeFillerWords: false,
  appendTrailingSpace: false,
  hotkey: null,
  mode: 'smart',
  language: 'sk',
  microphone: { deviceId: null, label: null },
  engineOrder: ['local'],
  localModelId: null,
  localAcceleration: 'auto',
  localModelUnload: 5,
  insertion: 'paste',
  clipboardPolicy: 'restore',
  autoSubmit: 'off',
  linuxPasteShortcut: 'ctrl-v',
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
    expect(appWindows(app)).toHaveLength(1);
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

function setRecordedHotkey(result: HotkeyRecordResult): Promise<void> {
  return app.evaluate((_electron, key) => {
    (globalThis as unknown as FakeHelperGlobal).codevoE2e.helper.recordedHotkey = key;
  }, result);
}

test.describe('settings page', () => {
  test('recording audio discovery preserves missing devices and explains unavailable and failed states', async () => {
    await page.evaluate(() => window.codevo.updateSettings({ audioFeedback: true, feedbackOutputId: 'disconnected', feedbackVolume: 73 }));
    const output = page.getByRole('combobox', { name: 'Výstupné zariadenie', exact: true });
    const volume = page.getByRole('slider', { name: 'Hlasitosť', exact: true });
    await expect(output).toHaveValue('disconnected');
    await expect(output.locator('option:checked')).toHaveText('Vybrané zariadenie (nepripojené)');
    await expect(page.getByText('Vybrané zariadenie nie je pripojené. Zvuky použijú systémový predvolený výstup.')).toBeVisible();
    await app.evaluate(() => {
      (globalThis as unknown as FakeHelperGlobal).codevoE2e.helper.outputAudio = { kind: 'unavailable', reason: 'platform' };
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('Zvuková odozva na tomto systéme zatiaľ nie je dostupná.')).toBeVisible();
    await expect(output).toBeDisabled();
    await expect(volume).toBeDisabled();
    await expect(volume).toHaveValue('73');
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('output-audio:get');
      ipcMain.handle('output-audio:get', () => Promise.reject(new Error('device lookup failed')));
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('alert').filter({ hasText: 'Výstupné zariadenia sa nepodarilo načítať.' })).toBeVisible();
    expect(await page.evaluate(() => window.codevo.getSettings())).toMatchObject({ audioFeedback: true, feedbackOutputId: 'disconnected', feedbackVolume: 73 });
  });
  test('recording audio controls keep saved values after a write error', async () => {
    await expect(page.getByRole('switch', { name: 'Zvuková odozva', exact: true })).toBeEnabled();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('settings:update');
      ipcMain.handle('settings:update', () => Promise.reject(new Error('disk full')));
    });
    await page.getByRole('switch', { name: 'Zvuková odozva', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Zmenu sa nepodarilo uložiť.' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Zvuková odozva', exact: true })).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('slider', { name: 'Hlasitosť', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.codevo.getSettings())).toMatchObject({ audioFeedback: false, feedbackOutputId: null, feedbackVolume: 50 });
  });
  test('recording audio controls preserve keyboard choices and disabled preferences across relaunch', async () => {
    const mute = page.getByRole('switch', { name: 'Stlmiť počas nahrávania', exact: true });
    const feedback = page.getByRole('switch', { name: 'Zvuková odozva', exact: true });
    const output = page.getByRole('combobox', { name: 'Výstupné zariadenie', exact: true });
    const volume = page.getByRole('slider', { name: 'Hlasitosť', exact: true });
    await expect(mute).toHaveAttribute('aria-checked', 'false');
    await expect(feedback).toHaveAttribute('aria-checked', 'false');
    await expect(output).toBeDisabled();
    await expect(volume).toBeDisabled();
    await expect(volume).toHaveValue('50');
    expect(await page.evaluate(() => window.codevo.getOutputAudio())).toMatchObject({ kind: 'available', canMute: true });
    for (const toggle of [mute, feedback]) {
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
    }
    await expect(output).toBeEnabled();
    await output.selectOption('headphones');
    await volume.focus();
    await page.keyboard.press('End');
    await expect(volume).toHaveValue('100');
    await page.keyboard.press('ArrowLeft');
    await expect(volume).toHaveValue('99');
    expect(await volume.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
    for (const width of [980, 760]) {
      await page.setViewportSize({ width, height: 760 });
      await volume.scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`recording-audio-${width}.png`) });
      const layout = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth, scrollers: [...document.querySelectorAll('*')].filter((element) => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === 'auto').map((element) => ({ tag: element.tagName, className: element.className, height: element.clientHeight, scrollHeight: element.scrollHeight, width: element.clientWidth, scrollWidth: element.scrollWidth })) }));
      test.info().annotations.push({ type: `layout-${width}`, description: JSON.stringify(layout) });
      expect(layout.content).toBeLessThanOrEqual(layout.viewport);
      if (width === 760) {
        await page.locator('.panel').evaluate((element) => { element.scrollLeft = element.scrollWidth - element.clientWidth; });
        await page.screenshot({ path: test.info().outputPath('recording-audio-760-scrolled.png') });
      }
    }
    await feedback.click();
    await expect(output).toBeDisabled();
    await expect(volume).toBeDisabled();
    await expect(output).toHaveValue('headphones');
    await expect(volume).toHaveValue('99');
    await expect.poll(() => page.evaluate(() => window.codevo.getSettings())).toMatchObject({ muteWhileRecording: true, audioFeedback: false, feedbackOutputId: 'headphones', feedbackVolume: 99 });
    await app.close();
    await start();
    await openSettings();
    await expect(page.getByRole('switch', { name: 'Stlmiť počas nahrávania', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('combobox', { name: 'Výstupné zariadenie', exact: true })).toHaveValue('headphones');
    await expect(page.getByRole('slider', { name: 'Hlasitosť', exact: true })).toHaveValue('99');
    expect(JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8'))).toMatchObject({ muteWhileRecording: true, audioFeedback: false, feedbackOutputId: 'headphones', feedbackVolume: 99 });
  });
  test('fake-helper replay types saved Unicode and suffix with current output preferences', async () => {
    await app.evaluate(() => {
      const { helper, lastTranscript } = (globalThis as unknown as FakeHelperGlobal).codevoE2e;
      helper.clipboard = 'original';
      lastTranscript.set(' Žilina é 🚀 ', { appendTrailingSpace: true });
    });
    await page.evaluate(() => window.codevo.updateSettings({ insertion: 'type', clipboardPolicy: 'restore', autoSubmit: 'enter', appendTrailingSpace: false }));
    const replay = () => app.evaluate(() => { (globalThis as unknown as FakeHelperGlobal).codevoE2e.helper.pressPasteLast(); });
    const output = () => app.evaluate(() => {
      const helper = (globalThis as unknown as FakeHelperGlobal).codevoE2e.helper;
      return { typed: helper.typed, pasted: helper.pasted, submitted: helper.submitted, clipboard: helper.clipboard };
    });
    await replay();
    await expect.poll(output).toEqual({ typed: ['Žilina é 🚀 '], pasted: [], submitted: ['enter'], clipboard: 'original' });
    await page.evaluate(() => window.codevo.updateSettings({ clipboardPolicy: 'leave', autoSubmit: 'off' }));
    await replay();
    await expect.poll(output).toEqual({ typed: ['Žilina é 🚀 ', 'Žilina é 🚀 '], pasted: [], submitted: ['enter'], clipboard: 'Žilina é 🚀 ' });
    await page.evaluate(() => window.codevo.updateSettings({ insertion: 'clipboard', autoSubmit: 'primary-enter' }));
    await app.evaluate(() => { (globalThis as unknown as FakeHelperGlobal).codevoE2e.helper.clipboard = 'changed'; });
    await replay();
    await expect.poll(output).toEqual({ typed: ['Žilina é 🚀 ', 'Žilina é 🚀 '], pasted: [], submitted: ['enter'], clipboard: 'Žilina é 🚀 ' });
    await page.getByRole('tab', { name: 'Domov' }).click();
    await page.locator('.last').getByRole('button', { name: 'Kopírovať', exact: true }).click();
    await expect(page.locator('.last').getByRole('button', { name: 'Skopírované' })).toBeVisible();
    expect(await output()).toEqual({ typed: ['Žilina é 🚀 ', 'Žilina é 🚀 '], pasted: [], submitted: ['enter'], clipboard: 'Žilina é 🚀 ' });
  });
  test('output settings reject invalid IPC values and retain defaults after a save error', async () => {
    const original = await page.evaluate(() => window.codevo.getSettings());
    for (const patch of [{ insertion: 'typing' }, { clipboardPolicy: 'clear' }, { autoSubmit: 'cmd-enter' }, { autoSubmit: true }]) {
      const error = await page.evaluate(async (invalid) => {
        try {
          await window.codevo.updateSettings(JSON.parse(JSON.stringify(invalid)) as Partial<Settings>);
          return 'accepted';
        } catch (failure) {
          return String(failure);
        }
      }, patch);
      expect(error).toContain('IpcValidationError');
    }
    expect(await page.evaluate(() => window.codevo.getSettings())).toEqual(original);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('settings:update');
      ipcMain.handle('settings:update', () => Promise.reject(new Error('disk full')));
    });
    await page.getByRole('combobox', { name: 'Automatické odoslanie', exact: true }).selectOption('enter');
    await expect(page.getByRole('alert').filter({ hasText: 'Zmenu sa nepodarilo uložiť.' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Automatické odoslanie', exact: true })).toHaveValue('off');
    expect(await page.evaluate(() => window.codevo.getSettings())).toEqual(original);
  });
  test('output controls preserve defaults, keyboard choices and disabled values across relaunch', async () => {
    const policy = page.getByRole('combobox', { name: 'Schránka', exact: true });
    const submit = page.getByRole('combobox', { name: 'Automatické odoslanie', exact: true });
    await expect(page.getByRole('radio', { name: 'Vložiť do aktívnej aplikácie' })).toBeChecked();
    await expect(policy).toHaveValue('restore');
    await expect(submit).toHaveValue('off');
    await page.getByRole('radio', { name: 'Priame písanie' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('radio', { name: 'Priame písanie' })).toBeChecked();
    await policy.selectOption('leave');
    await submit.selectOption('primary-enter');
    await expect.poll(() => page.evaluate(() => window.codevo.getSettings())).toMatchObject({ insertion: 'type', clipboardPolicy: 'leave', autoSubmit: 'primary-enter' });
    await page.screenshot({ path: test.info().outputPath('output-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 760, height: 780 });
    await policy.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('output-760.png'), fullPage: true });
    await page.getByRole('radio', { name: 'Iba skopírovať do schránky' }).click();
    await expect(page.getByRole('radio', { name: 'Iba skopírovať do schránky' })).toBeChecked();
    await expect(policy).toBeDisabled();
    await expect(submit).toBeDisabled();
    await expect(policy).toHaveValue('leave');
    await expect(submit).toHaveValue('primary-enter');
    await expect.poll(() => page.evaluate(() => window.codevo.getSettings().then((settings) => settings.insertion))).toBe('clipboard');
    await app.close();
    await start();
    await openSettings();
    await expect(page.getByRole('radio', { name: 'Iba skopírovať do schránky' })).toBeChecked();
    await expect(page.getByRole('combobox', { name: 'Schránka', exact: true })).toHaveValue('leave');
    await expect(page.getByRole('combobox', { name: 'Automatické odoslanie', exact: true })).toHaveValue('primary-enter');
  });
  test.beforeEach(async () => {
    userDataDir = await createUserDataDir(ONBOARDED);
    await start();
    await openSettings();
  });

  test('transcript preferences validate drafts and persist explicit saves across relaunch', async () => {
    const words = page.getByRole('textbox', { name: 'Vlastné slová', exact: true });
    const save = page.getByRole('button', { name: 'Uložiť slová', exact: true });
    await expect(words).toHaveValue('');
    await expect(save).toBeDisabled();
    await words.fill('two words');
    await save.click();
    await expect(words).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert')).toContainText('jedno slovo');
    expect((await page.evaluate(() => window.codevo.getSettings())).customWords).toEqual([]);
    await words.fill(' Kumiba \nŽilina\nKUMIBA\nZ\u030cilina');
    expect((await page.evaluate(() => window.codevo.getSettings())).customWords).toEqual([]);
    await save.click();
    await expect(save).toBeDisabled();
    await expect(words).toHaveValue('Kumiba\nŽilina');
    for (const name of ['Odstrániť výplňové slová', 'Pridať medzeru na konci']) {
      const toggle = page.getByRole('switch', { name, exact: true });
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
    }
    await expect.poll(() => page.evaluate(() => window.codevo.getSettings())).toMatchObject({ customWords: ['Kumiba', 'Žilina'], removeFillerWords: true, appendTrailingSpace: true });
    await app.close();
    await start();
    await openSettings();
    await expect(page.getByRole('textbox', { name: 'Vlastné slová', exact: true })).toHaveValue('Kumiba\nŽilina');
    await expect(page.getByRole('switch', { name: 'Pridať medzeru na konci', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('switch', { name: 'Odstrániť výplňové slová', exact: true })).toHaveAttribute('aria-checked', 'true');
    for (const width of [980, 760]) {
      await page.setViewportSize({ width, height: 760 });
      await page.getByRole('region', { name: 'Úprava prepisu' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`transcript-settings-${width}.png`) });
    }
  });

  test('smart is the default and persists after switching modes and relaunching', async () => {
    const modes = page.getByRole('group', { name: 'Režim klávesu' });
    const smart = modes.getByRole('button', { name: 'Inteligentný', exact: true });
    await expect(smart).toHaveAttribute('aria-pressed', 'true');
    await expect(row('Režim')).toContainText('Krátke stlačenie zapne diktovanie, ďalšie ho ukončí. Pri podržaní aspoň 300 ms sa diktovanie ukončí uvoľnením klávesu.');

    for (const label of ['Podrž klávesu', 'Prepínanie']) {
      const legacy = modes.getByRole('button', { name: label, exact: true });
      await legacy.click();
      await expect(legacy).toHaveAttribute('aria-pressed', 'true');
    }
    await smart.focus();
    await page.keyboard.press('Enter');
    await expect(smart).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => window.codevo.getSettings().then((settings) => settings.mode))).toBe('smart');
    await expect.poll(async () => JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as unknown).toMatchObject({ mode: 'smart' });

    await app.close();
    await start();
    await openSettings();
    await expect(page.getByRole('button', { name: 'Inteligentný', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('resident settings show all seven unload options, acceleration defaults and persist across relaunch', async () => {
    const unload = page.getByRole('combobox', { name: 'Uvoľniť model' });
    const acceleration = page.getByRole('group', { name: 'Akcelerácia' });
    const expectedOptions = [
      ['never', 'Nikdy'], ['immediately', 'Ihneď'], ['2', 'Po 2 minútach'], ['5', 'Po 5 minútach'],
      ['10', 'Po 10 minútach'], ['15', 'Po 15 minútach'], ['60', 'Po 1 hodine'],
    ];
    await expect(unload.locator('option')).toHaveCount(7);
    expect(await unload.locator('option').evaluateAll((options) => options.map((option) => [option.getAttribute('value'), option.textContent]))).toEqual(expectedOptions);
    await expect(unload).toHaveValue('5');
    await expect(acceleration.getByRole('button')).toHaveText(['Auto', 'GPU', 'CPU']);
    await expect(acceleration.getByRole('button', { name: 'Auto', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Inteligentný', exact: true })).toHaveAttribute('aria-pressed', 'true');
    for (const [value] of expectedOptions) {
      await unload.selectOption(value ?? '');
      await expect(unload).toHaveValue(value ?? '');
    }
    for (const label of ['GPU', 'Auto', 'CPU']) {
      await acceleration.getByRole('button', { name: label, exact: true }).click();
      await expect(acceleration.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    await unload.selectOption('10');
    await expect.poll(() => page.evaluate(() => window.codevo.getSettings())).toMatchObject({ localModelUnload: 10, localAcceleration: 'cpu', mode: 'smart' });
    await expect.poll(async () => JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as unknown).toMatchObject({ localModelUnload: 10, localAcceleration: 'cpu', mode: 'smart' });
    await app.close();
    await start();
    await openSettings();
    await expect(page.getByRole('combobox', { name: 'Uvoľniť model' })).toHaveValue('10');
    await expect(page.getByRole('group', { name: 'Akcelerácia' }).getByRole('button', { name: 'CPU', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Inteligentný', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.codevo.getSettings())).toMatchObject({ localModelUnload: 10, localAcceleration: 'cpu', mode: 'smart' });
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

    await setRecordedHotkey({ kind: 'modifiers', keycodes: [62], label: 'Pravý ⌃ Control' });
    await recorder.click();

    await expect(recorder).toContainText('Pravý ⌃ Control');
    await expect.poll(() => page.evaluate(() => window.codevo.getSettings().then((settings) => settings.hotkey))).toEqual({ kind: 'modifiers', keycodes: [62], label: 'Pravý ⌃ Control' });

    await setRecordedHotkey('unsupported');
    await recorder.click();
    await expect(row('Klávesová skratka').getByRole('alert')).toContainText('Túto skratku nemožno použiť.');
    await expect(recorder).toContainText('Pravý ⌃ Control');
  });

  test('the server engine orders are visible but disabled with a note', async () => {
    const engine = page.getByRole('radiogroup', { name: 'Kde beží prepis' });
    await expect(engine.getByRole('radio')).toHaveCount(4);
    await expect(engine.getByRole('radio', { name: /^Lokálne/ }).first()).toBeChecked();
    await expect(engine.getByRole('radio', { name: /^Server/ }).first()).toBeDisabled();
    await expect(page.getByText('Najprv spárujte server na stránke Server.')).toBeVisible();
  });

  test('Živý text can be chosen next to the default indicator and is saved', async () => {
    const overlay = page.getByRole('group', { name: 'Zobrazenie panela' });
    await expect(overlay.getByRole('button', { name: 'Indikátor' })).toHaveAttribute('aria-pressed', 'true');
    await expect(row('Zobrazenie panela')).toContainText('Živý text ukazuje prepis už počas hovorenia. Indikátor je diskrétnejší a prepis je rýchlejší.');
    await expect(row('Zobrazenie panela')).not.toContainText('Príde v ďalšej verzii');

    await overlay.getByRole('button', { name: 'Živý text' }).click();

    await expect(overlay.getByRole('button', { name: 'Živý text' })).toHaveAttribute('aria-pressed', 'true');
    await expect(overlay.getByRole('button', { name: 'Indikátor' })).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => page.evaluate(() => window.codevo.getSettings().then((settings) => settings.overlay))).toBe('live');
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

  test('transcript preferences keep an editable draft after a failed save', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('settings:update');
      ipcMain.handle('settings:update', () => Promise.reject(new Error('disk full')));
    });
    const words = page.getByRole('textbox', { name: 'Vlastné slová', exact: true });
    const save = page.getByRole('button', { name: 'Uložiť slová', exact: true });
    await words.fill('Kumiba');
    await save.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Slová sa nepodarilo uložiť.' })).toBeVisible();
    await expect(words).toBeEnabled();
    await expect(words).toHaveValue('Kumiba');
    await expect(save).toBeEnabled();
    expect((await page.evaluate(() => window.codevo.getSettings())).customWords).toEqual([]);
  });

  test('a setting that cannot be saved shows an inline error', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('settings:update');
      ipcMain.handle('settings:update', () => Promise.reject(new Error('disk full')));
    });

    await page.getByRole('group', { name: 'Režim klávesu' }).getByRole('button', { name: 'Prepínanie' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Zmenu sa nepodarilo uložiť.' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Režim klávesu' }).getByRole('button', { name: 'Inteligentný' })).toHaveAttribute('aria-pressed', 'true');
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
    const disabled = page.getByRole('radiogroup', { name: 'Kde beží prepis' }).locator('label').filter({ has: page.locator('input:disabled') }).first();

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
