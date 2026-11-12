import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { mainWindow } from './app-windows';
import { createUserDataDir, launchApp, ONBOARDED } from './launch-app';

test('Linux settings explicitly enable text-field recognition for an existing installation', async () => {
  test.skip(process.platform !== 'linux');
  const dir = await createUserDataDir(ONBOARDED);
  const app = await launchApp(dir);
  try {
    const page = await mainWindow(app);
    await page.getByRole('tab', { name: 'Nastavenia', exact: true }).click();
    const enable = page.getByRole('button', { name: 'Povoliť rozpoznávanie polí', exact: true });
    await expect(enable).toBeVisible({ timeout: 3000 });
    await enable.click();
    await expect.poll(() => page.evaluate(() => window.codevo.getPermissions())).toMatchObject({ accessibility: true });
    await expect(enable).toHaveCount(0);
  } finally { await app.close(); }
});

test('Linux paste shortcut settings persist and reject invalid values', async () => {
  test.skip(process.platform !== 'linux');
  const dir = await createUserDataDir(ONBOARDED);
  const app = await launchApp(dir);
  try {
    const page = await mainWindow(app);
    await page.getByRole('tab', { name: 'Nastavenia', exact: true }).click();
    const shortcut = page.getByRole('combobox', { name: 'Skratka na vloženie' });
    await expect(shortcut).toHaveValue('ctrl-v');
    for (const value of ['ctrl-shift-v', 'shift-insert', 'ctrl-v']) {
      await shortcut.selectOption(value);
      await expect.poll(() => page.evaluate(() => window.codevo.getSettings())).toMatchObject({ linuxPasteShortcut: value });
    }
    await expect(page.evaluate('window.codevo.updateSettings({linuxPasteShortcut:"try-all"})')).rejects.toThrow();
    await expect(page.getByText('Zobraziť vo Finderi', { exact: true })).toHaveCount(0);
    await shortcut.focus();
    await expect(shortcut).toBeFocused();
    for (const width of [1000, 800]) {
      await app.evaluate(({ BrowserWindow }, width) => { BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Codevo Whisper')?.setSize(width, 760); }, width);
      await page.screenshot({ path: join(dir, `linux-settings-${width}.png`), fullPage: true });
    }
  } finally { await app.close(); }
});

test('Linux Jazyky diktovania reorders the used languages and fits narrow windows', async () => {
  test.skip(process.platform !== 'linux');
  const dir = await createUserDataDir({ ...ONBOARDED, languages: { mode: 'selected', selected: ['sk', 'cs'] } });
  const app = await launchApp(dir);
  try {
    const page = await mainWindow(app);
    await page.getByRole('tab', { name: 'Nastavenia', exact: true }).click();
    const used = () => page.getByRole('region', { name: 'Používané jazyky' }).getByRole('listitem');
    await expect(used()).toHaveText([/Slovenčina/, /Čeština/]);
    await used().filter({ hasText: 'Slovenčina' }).focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(used()).toHaveText([/Čeština/, /Slovenčina/]);
    await expect(used().first()).toContainText('Hlavný');
    await expect(used().filter({ hasText: 'Slovenčina' })).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.codevo.getSettings().then((settings) => settings.languages))).toEqual({ mode: 'selected', selected: ['cs', 'sk'] });
    await page.getByRole('region', { name: 'Ďalšie jazyky' }).getByRole('button', { name: 'Pridať Nemčina', exact: true }).dragTo(used().filter({ hasText: 'Čeština' }), { targetPosition: { x: 24, y: 3 } });
    await expect(used()).toHaveText([/Nemčina/, /Čeština/, /Slovenčina/]);
    for (const width of [1000, 800]) {
      await app.evaluate(({ BrowserWindow }, width) => { BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Codevo Whisper')?.setSize(width, 760); }, width);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({ path: join(dir, `linux-languages-${width}.png`), fullPage: true });
    }
  } finally { await app.close(); }
});

test('Linux onboarding explains keyboard access and manual paste without Mac relaunch instructions', async () => {
  test.skip(process.platform !== 'linux');
  const dir = await createUserDataDir();
  const app = await launchApp(dir);
  try {
    const page = await mainWindow(app);
    await page.getByRole('button', { name: 'Ďalej', exact: true }).click();
    await expect(page.getByText('Po zmene medzi X11 a Waylandom nahrajte skratku znova.', { exact: false })).toBeVisible();
    const permissions = await page.evaluate(() => window.codevo.getPermissions());
    if (!permissions.inputMonitoring) await expect(page.getByRole('button', { name: 'Skontrolovať znova' })).toBeVisible();
    const keyboard = page.locator('.perm').filter({ has: page.getByText('Prístup ku klávesnici', { exact: true }) });
    await expect(keyboard.getByText(permissions.inputMonitoring ? 'Povolené' : 'Zatiaľ nepovolené', { exact: true })).toBeVisible();
    await expect(page.getByText('Zobraziť vo Finderi', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Reštartovať', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: join(dir, 'linux-onboarding.png'), fullPage: true });
  } finally { await app.close(); }
});
