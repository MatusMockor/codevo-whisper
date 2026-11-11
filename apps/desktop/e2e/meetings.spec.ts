import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { join } from 'node:path';
import { consoleLogger } from '../src/main/logging/logger';
import { MeetingStore } from '../src/main/meetings/meeting-store';
import type { Turn } from '../src/shared/meetings';
import { mainWindow } from './app-windows';
import { createUserDataDir, launchApp, ONBOARDED, removeUserDataDir } from './launch-app';

const TURNS: Turn[] = [
  { speaker: 'Ja', t0Ms: 0, t1Ms: 6_000, text: 'Dobrý deň, dnes potrebujeme rozhodnúť termín spustenia.' },
  { speaker: 'Ostatní', t0Ms: 6_500, t1Ms: 15_000, text: 'Navrhujem piatok, testy budú hotové vo štvrtok.' },
  { speaker: 'Ja', t0Ms: 15_500, t1Ms: 24_000, text: 'Dobre, spustíme v piatok.' },
];

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

async function seedMeeting(dir: string): Promise<void> {
  const store = new MeetingStore(join(dir, 'meetings'), consoleLogger);
  await store.load();
  const { id } = await store.create({ startedAt: Date.UTC(2026, 10, 11, 9, 30), systemAudio: 'recording', systemAudioNote: null });
  await store.update(id, { durationMs: 30_000 });
  await store.finishTranscript(id, TURNS);
}

async function start(seed?: (dir: string) => Promise<void>): Promise<void> {
  userDataDir = await createUserDataDir(ONBOARDED);
  await seed?.(userDataDir);
  app = await launchApp(userDataDir);
  page = await mainWindow(app);
  await page.getByRole('tab', { name: 'Stretnutia' }).click();
}

async function expectFocusedHeading(tab: string, heading: string): Promise<void> {
  await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 2, name: heading, exact: true })).toBeFocused();
}

function step(title: string): Locator {
  return page.locator('.meet-step', { hasText: title });
}

function notes(): Locator {
  return page.getByRole('region', { name: 'Poznámky', exact: true });
}

test.afterEach(async () => {
  await app.close();
  await removeUserDataDir(userDataDir);
});

test('the empty meetings page shows each step with its state and opens the exact setting that is missing', async () => {
  await start();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nahrávanie a prepis stretnutí');
  await expect(page.getByText('Zatiaľ nemáte žiadne nahrané stretnutia.', { exact: false })).toBeVisible();
  await expect(step('Prepíšte lokálne')).toContainText('Chýba lokálny model');
  await expect(step('Rozlíšte hovoriacich')).toContainText('Voliteľné, model nie je stiahnutý');
  await expect(step('Vytvorte poznámky')).toContainText('AI úprava nie je nastavená');
  await expect(page.getByRole('button', { name: 'Otvoriť Nastavenia' })).toHaveCount(0);

  await step('Vytvorte poznámky').getByRole('button', { name: 'Nastaviť AI úpravu' }).click();
  await expectFocusedHeading('Nastavenia', 'AI úprava textu');

  await page.getByRole('tab', { name: 'Stretnutia' }).click();
  await page.locator('.meeting-record').getByRole('button', { name: 'Stiahnuť model' }).click();
  await expectFocusedHeading('Prepis', 'Lokálny model');
});

test('a recorded meeting shows the speaker timeline and transcript, and a notes failure links the AI settings', async () => {
  await start(seedMeeting);

  const detail = page.getByRole('region', { name: /^Stretnutie / });
  await expect(detail.getByRole('img', { name: 'Časová os hovoriacich: Ja, Ostatní' })).toBeVisible();
  const turns = detail.getByRole('list', { name: 'Prepis stretnutia' }).getByRole('listitem');
  await expect(turns).toHaveCount(TURNS.length);
  await expect(turns.nth(1)).toContainText('Ostatní');
  await expect(turns.nth(1)).toContainText('Navrhujem piatok');
  await expect(page.getByRole('list', { name: 'Nahrané stretnutia' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByText('Zatiaľ nemáte žiadne nahrané stretnutia.', { exact: false })).toHaveCount(0);

  await expect(notes().getByRole('button', { name: 'Vytvoriť poznámky' })).toBeDisabled();
  await expect(notes()).toContainText('Zatiaľ nie je nastavený ani jeden.');
  await notes().getByRole('button', { name: 'Nastaviť AI úpravu' }).click();
  await expectFocusedHeading('Nastavenia', 'AI úprava textu');

  await page.evaluate(() => window.codevo.updateSettings({ aiBaseUrl: 'http://127.0.0.1:9/v1', aiModel: 'missing' }));
  await page.getByRole('tab', { name: 'Stretnutia' }).click();
  await expect(notes()).toContainText('Poznámky vytvára váš AI server');
  await notes().getByRole('button', { name: 'Vytvoriť poznámky' }).click();
  const failure = page.getByRole('alert');
  await expect(failure).toContainText('AI server sa nepodarilo zastihnúť', { timeout: 30_000 });
  await failure.getByRole('button', { name: 'Skontrolovať AI server' }).click();
  await expectFocusedHeading('Nastavenia', 'AI úprava textu');
});
