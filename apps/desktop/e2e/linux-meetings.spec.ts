import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { MeetingSummary } from '../src/shared/meetings';
import { appWindows } from './app-windows';
import { createUserDataDir, FAKE_MEDIA_ARGS, launchApp, ONBOARDED, removeUserDataDir } from './launch-app';

const run = promisify(execFile);
const MODEL = process.env['CW_E2E_MEETING_MODEL'];
const AUDIO = process.env['CW_E2E_MEETING_AUDIO'];
const DIARIZER = process.env['CW_E2E_DIARIZER_MODEL'];
const SPEAKERS_AUDIO = process.env['CW_E2E_SPEAKERS_AUDIO'];
const DIARIZER_FILE = 'sortformer-4spk-v2-1-q8.gguf';
const SHOTS = process.env['CW_E2E_SHOTS'];
const BYTES_PER_SECOND = 32_000;
const NO_CAP_MS = 600_000;
const OZONE = process.env['XDG_SESSION_TYPE'] === 'wayland' ? ['--ozone-platform=wayland'] : [];

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

async function shot(name: string): Promise<void> {
  if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `${name}-${OZONE.length > 0 ? 'wayland' : 'x11'}.png`) });
}

function playSample(audio = AUDIO): Promise<unknown> {
  return run('pw-play', ['--volume', '0.3', resolve(audio ?? '')]);
}

function diarizerRow() {
  return page.getByRole('list', { name: 'Model na rozpoznávanie hovoriacich' }).getByRole('listitem');
}

async function speakerLabels(): Promise<string[]> {
  const lines = await page.getByRole('list', { name: 'Prepis stretnutia' }).getByRole('listitem').allTextContents();
  return [...new Set(lines.map((line) => /^\[[\d:]+\] ([^:]+):/.exec(line)?.[1] ?? ''))];
}

async function currentMeeting(): Promise<MeetingSummary> {
  const [meeting] = await page.evaluate(() => window.codevo.getMeetings());
  expect(meeting).toBeDefined();
  return meeting as MeetingSummary;
}

async function trackBytes(id: string, track: 'mic' | 'system'): Promise<number> {
  return (await stat(join(userDataDir, 'meetings', id, `${track}.pcm`))).size;
}

async function startMeeting(): Promise<MeetingSummary> {
  await page.getByRole('tab', { name: 'Stretnutia' }).click();
  await expect(page.getByText('Zatiaľ nemáte žiadne nahrané stretnutia.', { exact: false })).toBeVisible();
  await expect(diarizerRow()).toContainText('Nestiahnutý');
  await expect(page.getByText('Bez neho sa celá druhá strana označí ako Ostatní.', { exact: false })).toBeVisible();
  await shot('empty');
  await page.getByRole('button', { name: 'Začať nahrávanie' }).click();
  await expect(page.getByRole('timer', { name: 'Dĺžka nahrávania' })).toBeVisible();
  await expect(page.getByText('Zvuk systému: nahráva sa')).toBeVisible();
  return currentMeeting();
}

async function stopAndTranscribe(transcribeTimeoutMs: number): Promise<void> {
  await page.getByRole('button', { name: 'Zastaviť a prepísať' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Prepisuje sa|čaká na prepis/ })).toBeVisible();
  await shot('transcribing');
  const transcript = page.getByRole('list', { name: 'Prepis stretnutia' });
  await expect(transcript).toBeVisible({ timeout: transcribeTimeoutMs });
  await expect(transcript.getByText(/\] Ostatní: .*fellow Americans/).first()).toBeVisible();
  await shot('ready');
}

test.skip(process.platform !== 'linux' || MODEL === undefined || AUDIO === undefined, 'Set CW_E2E_MEETING_MODEL (parakeet-ultra-q8 gguf) and CW_E2E_MEETING_AUDIO to run the meeting e2e');

test.beforeEach(async () => {
  userDataDir = await createUserDataDir({ ...ONBOARDED, localModelId: 'parakeet-ultra-q8', language: 'en', localAcceleration: 'cpu' });
  await mkdir(join(userDataDir, 'models'));
  await symlink(resolve(MODEL ?? ''), join(userDataDir, 'models', 'parakeet-ultra-q8.gguf'));
  app = await launchApp(userDataDir, [...FAKE_MEDIA_ARGS, ...OZONE], { fakeHelper: true });
  await app.firstWindow();
  await expect.poll(() => appWindows(app).length).toBeGreaterThan(0);
  page = appWindows(app)[0] as Page;
});

test.afterEach(async () => {
  await app.close();
  await removeUserDataDir(userDataDir);
});

test('a meeting records the mic and the real system audio and shows a speaker-attributed transcript', async () => {
  test.setTimeout(300_000);
  expect(await app.evaluate(({ app: electronApp }) => electronApp.commandLine.getSwitchValue('ozone-platform'))).toBe(OZONE.length > 0 ? 'wayland' : 'x11');

  const meeting = await startMeeting();
  await playSample();
  await shot('recording');
  await stopAndTranscribe(240_000);

  expect(await trackBytes(meeting.id, 'mic')).toBeGreaterThan(10 * BYTES_PER_SECOND);
  expect(await trackBytes(meeting.id, 'system')).toBeGreaterThan(10 * BYTES_PER_SECOND);
  const stored = JSON.parse(await readFile(join(userDataDir, 'meetings', meeting.id, 'meeting.json'), 'utf8')) as Record<string, unknown>;
  expect(stored).toMatchObject({ phase: { kind: 'ready' }, systemAudio: 'recording', tracks: { mic: { startOffsetMs: expect.any(Number) as unknown }, system: { startOffsetMs: expect.any(Number) as unknown } } });
});

test('removing the local model during a meeting keeps the recording and its stop button', async () => {
  test.setTimeout(120_000);
  await startMeeting();

  await page.evaluate(async () => {
    const removed = new Promise<void>((resolve) => {
      const unsubscribe = window.codevo.on('model-states-changed', (states) => {
        if (!states.some((state) => state.id === 'parakeet-ultra-q8' && state.status === 'ready')) {
          unsubscribe();
          resolve();
        }
      });
    });
    await window.codevo.deleteModel('parakeet-ultra-q8');
    await removed;
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  await expect(page.getByRole('timer', { name: 'Dĺžka nahrávania' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Nahrávané stopy' })).toBeVisible();
  await page.getByRole('button', { name: 'Zastaviť a prepísať' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Lokálny model nie je stiahnutý.' })).toBeVisible();
  await expect(page.getByText('Najprv si v Nastaveniach stiahnite', { exact: false })).toBeVisible();
});

test.describe('remote speakers', () => {
  test.skip(DIARIZER === undefined || SPEAKERS_AUDIO === undefined, 'Set CW_E2E_DIARIZER_MODEL (Sortformer gguf) and CW_E2E_SPEAKERS_AUDIO (two remote speakers) to run the speaker e2e');

  test('the downloaded diarizer splits the remote side into numbered speakers on Prepísať znova', async () => {
    test.setTimeout(300_000);

    await startMeeting();
    await playSample(SPEAKERS_AUDIO);
    await stopAndTranscribe(240_000);
    expect(await speakerLabels()).not.toContainEqual(expect.stringMatching(/^Hovoriaci/));
    await shot('speakers-without-diarizer');

    await symlink(resolve(DIARIZER ?? ''), join(userDataDir, 'models', `${DIARIZER_FILE}.download`));
    await diarizerRow().getByRole('button', { name: 'Stiahnuť: Sortformer 4spk v2.1' }).click();
    await expect(diarizerRow()).toContainText('Používa sa', { timeout: 60_000 });
    await shot('speakers-diarizer-ready');

    await page.getByRole('button', { name: 'Prepísať znova' }).click();
    await expect(page.getByRole('status').filter({ hasText: /Prepisuje sa|Rozlišujú sa hovoriaci/ })).toBeVisible();
    const transcript = page.getByRole('list', { name: 'Prepis stretnutia' });
    await expect(transcript.getByText(/\] Hovoriaci 2: /).first()).toBeVisible({ timeout: 240_000 });
    const labels = await speakerLabels();
    test.info().annotations.push({ type: 'speakers', description: JSON.stringify(labels) });
    expect(labels.filter((label) => label.startsWith('Hovoriaci')).length).toBeGreaterThanOrEqual(2);
    await shot('speakers-ready');
  });
});

test.describe('long meeting', () => {
  test.skip(process.env['CW_E2E_LONG'] !== '1', 'Set CW_E2E_LONG=1 to run the 10 minute meeting check');

  test('a meeting keeps recording past the 10 minute dictation cap', async () => {
    test.setTimeout(45 * 60_000);

    const meeting = await startMeeting();
    await page.waitForTimeout(NO_CAP_MS + 5_000);
    await expect.poll(() => currentMeeting().then((current) => current.phase.kind)).toBe('recording');
    const micBytes = await trackBytes(meeting.id, 'mic');
    const systemBytes = await trackBytes(meeting.id, 'system');
    test.info().annotations.push({ type: 'bytes-after-605s', description: JSON.stringify({ micBytes, systemBytes }) });
    expect(micBytes).toBeGreaterThan((NO_CAP_MS / 1000) * BYTES_PER_SECOND);
    expect(systemBytes).toBeGreaterThan((NO_CAP_MS / 1000) * BYTES_PER_SECOND);
    await playSample();
    await stopAndTranscribe(30 * 60_000);

    const stopped = await currentMeeting();
    test.info().annotations.push({ type: 'meeting', description: JSON.stringify({ durationMs: stopped.durationMs, mic: await trackBytes(meeting.id, 'mic'), system: await trackBytes(meeting.id, 'system') }) });
    expect(stopped.durationMs).toBeGreaterThan(NO_CAP_MS);
  });
});
