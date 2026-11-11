import { homedir } from 'node:os';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { homeRelativePath } from '../src/main/system/home-relative-path';
import { mainWindow } from './app-windows';
import { createUserDataDir, launchApp, ONBOARDED, removeUserDataDir } from './launch-app';

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

function zone(name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

async function openPrivacy(): Promise<void> {
  await page.getByRole('tab', { name: 'Súkromie' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kam putuje váš hlas');
}

async function expectFocusedHeading(tab: string, heading: string): Promise<void> {
  await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 2, name: heading, exact: true })).toBeFocused();
}

test.beforeEach(async () => {
  userDataDir = await createUserDataDir(ONBOARDED);
  app = await launchApp(userDataDir);
  page = await mainWindow(app);
});

test.afterEach(async () => {
  await app.close();
  await removeUserDataDir(userDataDir);
});

test('each zone shows where the voice goes right now and links its setting', async () => {
  await openPrivacy();

  await expect(page.locator('.phead .sub')).toContainText('Ak použijete AI úpravu alebo poznámky zo stretnutí, text sa odošle zvolenému AI poskytovateľovi.');
  await expect(zone('Ostáva na tomto počítači')).toContainText('Teraz hlavný prepis');
  await expect(zone('Ide na váš server')).toContainText('Nepoužíva sa, server nie je spárovaný');
  await expect(zone('Ide k AI poskytovateľovi')).toContainText('Nepoužíva sa, AI úprava nie je nastavená');

  await zone('Ide na váš server').getByRole('button', { name: 'Spárovať server' }).click();
  await expectFocusedHeading('Prepis', 'Vlastný server');

  await page.evaluate(() => window.codevo.updateSettings({ aiProvider: 'codex', aiPolish: true }));
  await openPrivacy();
  const ai = zone('Ide k AI poskytovateľovi');
  await expect(ai.getByRole('list', { name: 'Cesta dát' }).getByRole('listitem')).toHaveText(['Text', 'OpenAI cez Codex CLI']);
  await expect(ai).toContainText('Teraz diktát aj poznámky zo stretnutí');
  await ai.getByRole('button', { name: 'Otvoriť AI úpravu' }).click();
  await expectFocusedHeading('Nastavenia', 'AI úprava textu');
});

test('the voice steps follow the dictation and the current transcription route', async () => {
  await openPrivacy();

  await expect(page.locator('.priv-steps li')).toHaveText([
    'Mikrofón sa zapne, až keď spustíte diktovanie skratkou, a vypne sa hneď, ako diktovanie skončí.',
    'Zvuk sa prepíše na text priamo na tomto počítači stiahnutým modelom.',
    'Zvuk diktátu existuje iba počas prepisu a hneď potom sa zahodí. Nahrávky stretnutí ostávajú v meetings/, kým ich nevymažete.',
    'Text sa vloží do aplikácie. Posledné diktovanie ostane iba v pamäti, kým aplikáciu nezatvoríte.',
  ]);
});

test('the stored files list names every file and keeps the history rules one click away', async () => {
  await openPrivacy();

  await expect(page.locator('.priv-folder code')).toHaveText(homeRelativePath(userDataDir, homedir()));

  const files = page.getByRole('list', { name: 'Uložené súbory' }).getByRole('listitem').locator('code');
  await expect(files).toHaveText(['settings.json', 'stats.json', 'history.json', 'meetings/', 'models/', 'server-pairing.json', 'ai-key.json', 'warm-up.json']);
  const rule = page.getByText('Predvolene je vypnutá.', { exact: false });
  await expect(rule).toBeHidden();
  await page.getByText('Ako funguje história prepisov').click();
  await expect(rule).toBeVisible();

  await page.getByRole('button', { name: 'Otvoriť históriu na stránke Domov' }).click();
  await expect(page.getByRole('tab', { name: 'Domov' })).toHaveAttribute('aria-selected', 'true');
});

test('the statistics link opens the reset setting directly', async () => {
  await openPrivacy();

  await page.getByRole('button', { name: 'Vynulovať štatistiky v Nastaveniach' }).click();
  await expect(page.getByRole('tab', { name: 'Nastavenia' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Vynulovať štatistiky', exact: true })).toBeFocused();
});
