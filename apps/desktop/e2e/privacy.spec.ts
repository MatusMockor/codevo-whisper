import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
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

test('the stored files list names every file and keeps the history rules one click away', async () => {
  await openPrivacy();

  const files = page.getByRole('list', { name: 'Uložené súbory' }).getByRole('listitem').locator('code');
  await expect(files).toHaveText(['settings.json', 'stats.json', 'history.json', 'meetings/', 'models/', 'server-pairing.json', 'ai-key.json', 'warm-up.json']);
  const rule = page.getByText('Predvolene je vypnutá.', { exact: false });
  await expect(rule).toBeHidden();
  await page.getByText('Ako funguje história prepisov').click();
  await expect(rule).toBeVisible();

  await page.getByRole('button', { name: 'Otvoriť históriu na stránke Domov' }).click();
  await expect(page.getByRole('tab', { name: 'Domov' })).toHaveAttribute('aria-selected', 'true');
});
