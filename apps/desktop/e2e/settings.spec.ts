import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { appWindows, mainWindow } from './app-windows';
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
  languages: { mode: 'auto', selected: ['sk'] },
  microphone: { deviceId: null, label: null },
  engineOrder: ['local'],
  serverEnabled: true,
  serverRestoreOrder: null,
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
  aiBaseUrl: null,
  aiModel: '',
  aiPolish: false,
  aiProvider: 'server',
  codexModel: 'gpt-6-luna',
  codexEffort: 'low',
};

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

async function start(): Promise<void> {
  app = await launchApp(userDataDir, FAKE_MEDIA_ARGS, { fakeHelper: true });
  page = await mainWindow(app);
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
    const updated = await page.evaluate(() => window.codevo.updateSettings({ mode: 'toggle', languages: { mode: 'selected', selected: ['en', 'sk'] } }));
    expect(updated).toEqual({ ...DEFAULTS, mode: 'toggle', languages: { mode: 'selected', selected: ['en', 'sk'] } });

    await app.close();
    await start();

    const onDisk = JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as unknown;
    expect(onDisk).toEqual({ ...DEFAULTS, mode: 'toggle', languages: { mode: 'selected', selected: ['en', 'sk'] } });
    expect(await page.evaluate(() => window.codevo.getSettings())).toEqual({ ...DEFAULTS, mode: 'toggle', languages: { mode: 'selected', selected: ['en', 'sk'] } });
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

const PALETTE_SHORTCUT = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';

function row(title: string): Locator {
  return page.locator('.srow', { has: page.locator('b', { hasText: title }) });
}

async function openSettings(): Promise<void> {
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nastavenia');
}

async function openTranscription(): Promise<void> {
  await page.getByRole('tab', { name: 'Prepis' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kde beží prepis');
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

function changeMainWindow(action: 'hide' | 'showInactive' | 'minimize' | 'restore'): Promise<void> {
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
    await openTranscription();
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
    await openTranscription();
    await expect(page.getByRole('combobox', { name: 'Uvoľniť model' })).toHaveValue('10');
    await expect(page.getByRole('group', { name: 'Akcelerácia' }).getByRole('button', { name: 'CPU', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.codevo.getSettings())).toMatchObject({ localModelUnload: 10, localAcceleration: 'cpu', mode: 'smart' });
  });

  test('changes to Režim, Vkladanie and Spustiť po prihlásení persist across a relaunch', async () => {
    await page.getByRole('group', { name: 'Režim klávesu' }).getByRole('button', { name: 'Prepínanie' }).click();
    await expect(row('Režim')).toContainText('Prvé stlačenie začne nahrávať, druhé ukončí.');
    await page.getByRole('radio', { name: /Iba skopírovať do schránky/ }).click();
    await expect(page.getByRole('radio', { name: /Iba skopírovať do schránky/ })).toBeChecked();
    await page.getByRole('switch', { name: 'Spustiť po prihlásení' }).click();
    await expect(page.getByRole('switch', { name: 'Spustiť po prihlásení' })).toHaveAttribute('aria-checked', 'true');

    await expect.poll(async () => JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as Settings).toMatchObject({
      mode: 'toggle',
      insertion: 'clipboard',
      launchAtLogin: true,
    });
    await app.close();
    await start();
    await openSettings();

    await expect(page.getByRole('group', { name: 'Režim klávesu' }).getByRole('button', { name: 'Prepínanie' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('radio', { name: /Iba skopírovať do schránky/ })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Spustiť po prihlásení' })).toHaveAttribute('aria-checked', 'true');
  });

  test('Jazyky diktovania switches the mode, selects and orders languages and keeps them across a relaunch', async () => {
    const languages = row('Jazyky diktovania');
    const modes = languages.getByRole('group', { name: 'Jazyky diktovania' });
    const chosen = languages.getByRole('list', { name: 'Zvolené jazyky' }).getByRole('listitem');
    const onDisk = async () => (JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as Settings).languages;
    await expect(modes.getByRole('button', { name: 'Automaticky' })).toHaveAttribute('aria-pressed', 'true');
    await expect(languages).toContainText('Jazyk rozpozná model sám.');
    await expect(languages.getByRole('checkbox')).toHaveCount(0);

    await modes.getByRole('button', { name: 'Zvolené jazyky' }).click();
    await expect(languages).toContainText('Prepíše sa len v zvolených jazykoch. Prvý jazyk je hlavný.');
    await expect(languages.getByRole('checkbox')).toHaveCount(25);
    await expect(chosen).toHaveText([/Slovenčina/]);
    await expect(chosen.first()).toContainText('Hlavný');
    await expect(languages).toContainText('Reč v príbuznom jazyku, napríklad v češtine, sa prepíše v zvolenom jazyku.');
    await expect(languages).toContainText('Výber jazykov platí pre diktovanie. Stretnutia sa prepisujú s automatickým rozpoznaním jazyka.');
    await expect.poll(onDisk).toEqual({ mode: 'selected', selected: ['sk'] });

    await languages.getByRole('checkbox', { name: 'Slovenčina' }).click();
    await expect(languages.getByRole('alert')).toHaveText('Aspoň jeden jazyk musí zostať zvolený.');
    await expect(languages.getByRole('checkbox', { name: 'Slovenčina' })).toBeChecked();

    for (const name of ['Čeština', 'Angličtina', 'Nemčina', 'Poľština']) {
      await languages.getByRole('checkbox', { name }).click();
      await expect(languages.getByRole('checkbox', { name })).toBeChecked();
    }
    await expect(languages).not.toContainText('Reč v príbuznom jazyku');
    await languages.getByRole('checkbox', { name: 'Maďarčina' }).click();
    await expect(languages.getByRole('alert')).toHaveText('Zvoliť môžete najviac 5 jazykov.');
    await expect(languages.getByRole('checkbox', { name: 'Maďarčina' })).not.toBeChecked();
    await expect(languages.getByRole('button', { name: 'Vyššie: Slovenčina' })).toBeDisabled();
    await expect(languages.getByRole('button', { name: 'Nižšie: Poľština' })).toBeDisabled();

    await languages.getByRole('button', { name: 'Vyššie: Čeština' }).click();
    await expect(chosen).toHaveText([/Čeština/, /Slovenčina/, /Angličtina/, /Nemčina/, /Poľština/]);
    await expect(chosen.first()).toContainText('Hlavný');
    await expect(languages.getByRole('button', { name: 'Nižšie: Čeština' })).toBeFocused();
    await languages.getByRole('button', { name: 'Nižšie: Angličtina' }).click();
    await expect(chosen).toHaveText([/Čeština/, /Slovenčina/, /Nemčina/, /Angličtina/, /Poľština/]);
    await expect.poll(onDisk).toEqual({ mode: 'selected', selected: ['cs', 'sk', 'de', 'en', 'pl'] });

    await app.close();
    await start();
    await openSettings();
    await expect(modes.getByRole('button', { name: 'Zvolené jazyky' })).toHaveAttribute('aria-pressed', 'true');
    await expect(chosen).toHaveText([/Čeština/, /Slovenčina/, /Nemčina/, /Angličtina/, /Poľština/]);

    await modes.getByRole('button', { name: 'Automaticky' }).click();
    await expect(languages.getByRole('checkbox')).toHaveCount(0);
    await expect.poll(onDisk).toEqual({ mode: 'auto', selected: ['cs', 'sk', 'de', 'en', 'pl'] });
    await app.close();
    await start();
    await openSettings();
    await expect(modes.getByRole('button', { name: 'Automaticky' })).toHaveAttribute('aria-pressed', 'true');
    await modes.getByRole('button', { name: 'Zvolené jazyky' }).click();
    await expect(chosen).toHaveText([/Čeština/, /Slovenčina/, /Nemčina/, /Angličtina/, /Poľština/]);
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

  test('the transcription groups moved to Prepis and Settings links there', async () => {
    await expect(page.getByRole('radiogroup', { name: 'Kde beží prepis' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Lokálny model' })).toHaveCount(0);

    await page.getByRole('button', { name: /^Kde beží prepis/ }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kde beží prepis');
    await expect(page.getByRole('heading', { level: 2, name: 'Trasa prepisu' })).toBeFocused();
    const route = page.locator('.route-card');
    await expect(route).toContainText('Trasa: Lokálne.');
    await expect(route).toContainText('Server ako záloha bude dostupný po spárovaní.');
    await expect(route.getByRole('button', { name: 'Vymeniť hlavný prepis a zálohu' })).toBeDisabled();
  });

  test('the search filters rows and groups live, marks matches and offers the palette when nothing matches', async () => {
    const search = page.getByRole('searchbox', { name: 'Hľadať v nastaveniach' });
    const groups = page.locator('.set-group:visible h2');
    await expect(groups).toHaveText(['Diktovanie', 'Mikrofón', 'Vkladanie textu', 'Úprava prepisu', 'AI úprava textu', 'História prepisov', 'Systém', ...(process.platform === 'linux' ? ['Prístup k systému'] : [])]);

    await search.fill('schranka');
    await expect(groups).toHaveText(['Vkladanie textu']);
    await expect(row('Schránka')).toBeVisible();
    await expect(row('Schránka').locator('mark')).toHaveText('Schránka');
    await expect(row('Automatické odoslanie')).toBeHidden();
    await expect(page.getByRole('radio', { name: 'Iba skopírovať do schránky' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Sekcie nastavení' }).getByRole('button', { name: /Vkladanie textu/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Sekcie nastavení' }).getByRole('button', { name: /Diktovanie/ })).toBeHidden();

    await search.fill('hlasitost');
    await expect(groups).toHaveText(['Diktovanie']);
    await expect(row('Hlasitosť')).toBeVisible();
    await expect(row('Režim')).toBeHidden();

    await search.fill('xyz neexistuje');
    await expect(groups).toHaveCount(0);
    await expect(page.getByText('Nič sa nenašlo.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'príkazovú paletu' }).click();
    const palette = page.getByRole('dialog', { name: 'Príkazová paleta' });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('combobox')).toHaveValue('xyz neexistuje');
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();

    await search.focus();
    await page.keyboard.press('Escape');
    await expect(search).toHaveValue('');
    await expect(groups).toHaveCount(process.platform === 'linux' ? 8 : 7);
  });

  test('the section index jumps to a group, focuses it and follows the scroll', async () => {
    const index = page.getByRole('navigation', { name: 'Sekcie nastavení' });
    await expect(index.getByRole('button', { name: /Diktovanie/ })).toHaveAttribute('aria-current', 'true');

    await index.getByRole('button', { name: /AI úprava textu/ }).click();

    await expect(page.getByRole('heading', { level: 2, name: 'AI úprava textu', exact: true })).toBeFocused();
    await expect(page.getByRole('region', { name: 'AI úprava textu', exact: true })).toBeInViewport();
    await expect(index.getByRole('button', { name: /AI úprava textu/ })).toHaveAttribute('aria-current', 'true');
    await expect(index.getByRole('button', { name: /Diktovanie/ })).not.toHaveAttribute('aria-current', 'true');
  });

  test('the command palette opens with the shortcut and jumps to a setting on any page', async () => {
    const shortcut = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';
    await page.getByRole('tab', { name: 'Domov' }).click();
    await page.keyboard.press(shortcut);
    const palette = page.getByRole('dialog', { name: 'Príkazová paleta' });
    const input = palette.getByRole('combobox', { name: 'Prejsť na nastavenie alebo stránku' });
    await expect(input).toBeFocused();
    await input.fill('hlasitost');
    await expect(palette.getByRole('option')).toHaveText([/Hlasitosť.*Diktovanie/]);
    await page.keyboard.press('Enter');

    await expect(palette).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nastavenia');
    await expect(page.getByRole('slider', { name: 'Hlasitosť', exact: true })).toBeInViewport();
    await expect(row('Hlasitosť')).toHaveClass(/flash/);

    await page.keyboard.press(shortcut);
    await input.fill('spustit');
    await expect(palette.getByRole('option', { selected: true })).toContainText('Spustiť po prihlásení');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('switch', { name: 'Spustiť po prihlásení' })).toBeFocused();

    await page.getByRole('button', { name: /^Paleta/ }).click();
    await expect(input).toHaveValue('');
    await input.fill('server');
    await palette.getByRole('option', { name: /Vlastný server/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kde beží prepis');
    await expect(page.getByRole('heading', { level: 2, name: 'Vlastný server' })).toBeFocused();

    await page.keyboard.press(shortcut);
    await expect(palette).toBeVisible();
    await page.keyboard.press(shortcut);
    await expect(palette).toBeHidden();
  });

  test('a palette jump clears the search so the target row is visible', async () => {
    await page.getByRole('searchbox', { name: 'Hľadať v nastaveniach' }).fill('jazyk');
    await expect(row('Štatistiky')).toBeHidden();
    await page.getByRole('button', { name: /^Paleta/ }).click();
    await page.getByRole('dialog', { name: 'Príkazová paleta' }).getByRole('combobox').fill('statistiky');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('searchbox', { name: 'Hľadať v nastaveniach' })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Vynulovať štatistiky' })).toBeFocused();
    await expect(row('Štatistiky')).toBeInViewport();
  });

  test('a palette jump from another page waits for a setting whose data loads later', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('history:get');
      ipcMain.handle('history:get', () => new Promise((resolve) => setTimeout(() => resolve({ kind: 'ready', policy: { enabled: false, limit: 100 }, entries: [], writeError: false }), 800)));
    });
    await page.getByRole('tab', { name: 'Domov' }).click();
    await page.keyboard.press(PALETTE_SHORTCUT);
    await page.getByRole('dialog', { name: 'Príkazová paleta' }).getByRole('combobox').fill('ukladat historiu');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nastavenia');
    await expect(page.getByRole('switch', { name: 'Ukladať históriu prepisov' })).toBeFocused();
    await expect(row('Ukladať históriu prepisov')).toBeInViewport();
  });

  test('a page command from the palette moves the focus to the heading of the new page', async () => {
    await page.getByRole('searchbox', { name: 'Hľadať v nastaveniach' }).focus();
    await page.keyboard.press(PALETTE_SHORTCUT);
    const palette = page.getByRole('dialog', { name: 'Príkazová paleta' });
    await palette.getByRole('combobox').fill('sukromie');
    await palette.getByRole('option', { name: /Súkromie.*Stránka/ }).click();

    await expect(palette).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Kam putuje váš hlas' })).toBeFocused();
  });

  test('the palette shortcut is left to the hotkey recorder while a new hotkey is recorded', async () => {
    await app.evaluate(() => {
      (globalThis as unknown as FakeHelperGlobal).codevoE2e.helper.holdRecordings = true;
    });
    const recorder = row('Klávesová skratka').locator('.hk');
    const palette = page.getByRole('dialog', { name: 'Príkazová paleta' });
    await recorder.click();
    await expect(recorder).toContainText('Stlačte novú skratku');

    await page.keyboard.press(PALETTE_SHORTCUT);
    await app.evaluate(() => {
      (globalThis as unknown as FakeHelperGlobal).codevoE2e.helper.finishRecording();
    });
    await expect(recorder).toContainText('Nenastavená');
    await expect(palette).toBeHidden();

    await page.keyboard.press(PALETTE_SHORTCUT);
    await expect(palette).toBeVisible();
  });

  test('the search keeps the AI provider switch next to the connection fields of either provider', async () => {
    await page.evaluate(() => window.codevo.updateSettings({ aiProvider: 'codex' }));
    const search = page.getByRole('searchbox', { name: 'Hľadať v nastaveniach' });
    const provider = page.getByRole('group', { name: 'Poskytovateľ AI' });
    const apiKey = page.getByLabel('API kľúč (nepovinné)');

    await search.fill('API kľúč');
    await expect(provider).toBeVisible();
    await expect(page.getByRole('group', { name: 'Úroveň uvažovania' })).toBeHidden();
    await provider.getByRole('button', { name: 'Vlastný server' }).click();
    await expect(apiKey).toBeVisible();

    await search.fill('úroveň uvažovania');
    await expect(apiKey).toBeHidden();
    await expect(provider).toBeVisible();
    await provider.getByRole('button', { name: 'Codex CLI' }).click();
    await expect(page.getByRole('group', { name: 'Úroveň uvažovania' })).toBeVisible();
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
    await openTranscription();
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

    await changeMainWindow('hide');
    await page.waitForTimeout(300);
    expect(await levelWithin(1500)).toBe(false);
    await changeMainWindow('showInactive');
    await expect.poll(() => levelWithin(1500)).toBe(true);

    await changeMainWindow('minimize');
    await page.waitForTimeout(300);
    expect(await levelWithin(1500)).toBe(false);
    await changeMainWindow('restore');
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
    const disabled = page.getByRole('button', { name: 'Uložiť slová', exact: true });

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
