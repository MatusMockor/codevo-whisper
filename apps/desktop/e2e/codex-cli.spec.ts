import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findCodex } from '../src/main/ai/codex-cli';
import type { E2eHooks } from '../src/main/app/e2e-hooks';
import type { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import { consoleLogger } from '../src/main/logging/logger';
import { MeetingStore } from '../src/main/meetings/meeting-store';
import type { Settings } from '../src/shared/settings';
import { mainWindow } from './app-windows';
import { createUserDataDir, FAKE_MEDIA_ARGS, launchApp, ONBOARDED, removeUserDataDir } from './launch-app';
import { startLocalGateway, type LocalGateway } from './local-gateway';

type Hooks = { codevoE2e: E2eHooks & { helper: FakeInputHelper }; aiFrames: number };

const RAW = 'prepis zo servera';
const DICTATIONS = 6;
const SHIM = `#!/usr/bin/env bash
out=""
args=("$@")
while [[ $# -gt 0 ]]; do
  [[ "$1" == "-o" ]] && out="$2"
  shift
done
"$CW_E2E_REAL_CODEX" "\${args[@]}"
code=$?
[[ -n "$out" && -f "$out" ]] && cp "$out" "$CW_E2E_CODEX_ANSWERS/$(date +%s%N).txt"
exit $code
`;

let app: ElectronApplication | null = null;
let page: Page;
let dir: string | null = null;
let gateway: LocalGateway | null = null;
let answers: string;
const originalPath = process.env['PATH'];

function launched(): ElectronApplication {
  if (app === null) throw new Error('the app is not running');
  return app;
}

function section() {
  return page.getByRole('region', { name: 'AI úprava textu', exact: true });
}

async function shoot(name: string, target = section()): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await target.screenshot({ path: test.info().outputPath(name) });
}

async function recordedAnswers(): Promise<string[]> {
  const files = (await readdir(answers)).sort();
  return Promise.all(files.map((file) => readFile(join(answers, file), 'utf8')));
}

async function start(settings: Partial<Settings>, seed?: (dir: string) => Promise<void>): Promise<void> {
  dir = await createUserDataDir({ ...ONBOARDED, hotkey: { kind: 'modifiers', keycodes: [63], label: 'Fn' }, mode: 'hold', ...settings });
  await seed?.(dir);
  app = await launchApp(dir, FAKE_MEDIA_ARGS, { fakeHelper: true });
  page = await mainWindow(launched());
}

async function pair(): Promise<void> {
  gateway = await startLocalGateway();
  const pairing = await gateway.openPairingWindow();
  await page.evaluate((token) => window.codevo.pairServer(token), pairing.token);
  await pairing.admin.next();
  pairing.admin.send({ decision: 'approve' });
  await pairing.admin.next();
  pairing.admin.close();
  await expect.poll(() => page.evaluate(() => window.codevo.getServer().then((view) => view.server?.status.kind))).toBe('online');
  await page.evaluate(() => window.codevo.updateSettings({ engineOrder: ['server'] }));
  await expect.poll(() => page.evaluate(() => window.codevo.isHotkeyArmed())).toBe(true);
  await launched().evaluate(() => {
    const hooks = globalThis as unknown as Hooks;
    hooks.aiFrames = 0;
    hooks.codevoE2e.capture.onFrame(() => { hooks.aiFrames++; });
  });
}

async function dictate(): Promise<{ text: string; afterReleaseMs: number }> {
  const electronApp = launched();
  const before = await electronApp.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.pasted.length);
  const frames = await electronApp.evaluate(() => (globalThis as unknown as Hooks).aiFrames);
  await electronApp.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.emitHotkey('down'));
  await expect.poll(() => electronApp.evaluate(() => (globalThis as unknown as Hooks).aiFrames)).toBeGreaterThan(frames + 2);
  await electronApp.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.emitHotkey('up'));
  const released = Date.now();
  await expect.poll(() => electronApp.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.pasted.length), { timeout: 30_000, intervals: [50] }).toBe(before + 1);
  const afterReleaseMs = Date.now() - released;
  const pasted = await electronApp.evaluate(() => (globalThis as unknown as Hooks).codevoE2e.helper.pasted);
  return { text: pasted.at(-1) ?? '', afterReleaseMs };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

test.beforeEach(async () => {
  const real = await findCodex();
  test.skip(real === null, 'requires a logged-in Codex CLI on PATH');
  const shimDir = test.info().outputPath('codex-shim');
  answers = test.info().outputPath('codex-answers');
  await mkdir(shimDir, { recursive: true });
  await mkdir(answers, { recursive: true });
  await writeFile(join(shimDir, 'codex'), SHIM);
  await chmod(join(shimDir, 'codex'), 0o755);
  process.env['CW_E2E_REAL_CODEX'] = real ?? '';
  process.env['CW_E2E_CODEX_ANSWERS'] = answers;
  process.env['PATH'] = `${shimDir}:${originalPath ?? ''}`;
});

test.afterEach(async () => {
  await app?.close();
  app = null;
  await gateway?.close();
  gateway = null;
  if (dir !== null) await removeUserDataDir(dir);
  dir = null;
  process.env['PATH'] = originalPath;
});

test('picking Codex CLI in Settings checks it and polishes dictation through it', async () => {
  test.setTimeout(240_000);
  await start({});
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  const polishSwitch = section().getByRole('switch', { name: 'Upraviť diktát cez AI' });
  await expect(polishSwitch).toBeDisabled();

  await section().getByRole('group', { name: 'Poskytovateľ AI' }).getByRole('button', { name: 'Codex CLI' }).click();
  await expect(section().getByText('odošle do OpenAI', { exact: false })).toBeVisible();
  await expect(section().getByLabel('Model', { exact: true })).toHaveValue('gpt-6-luna');
  await expect(section().getByRole('button', { name: 'Nízka (odporúčané)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(polishSwitch).toBeEnabled();
  await shoot('codex-settings.png');

  await section().getByRole('button', { name: 'Overiť Codex CLI' }).click();
  await expect(section().getByText('Codex CLI funguje.')).toBeVisible({ timeout: 60_000 });
  await shoot('codex-settings-checked.png');

  await polishSwitch.click();
  await expect(polishSwitch).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.evaluate(() => window.codevo.getSettings())).toMatchObject({ aiProvider: 'codex', codexModel: 'gpt-6-luna', codexEffort: 'low', aiPolish: true });
  const afterCheck = (await recordedAnswers()).length;

  await pair();
  const latencies: number[] = [];
  for (let run = 0; run < DICTATIONS; run++) {
    const { text, afterReleaseMs } = await dictate();
    const recorded = await recordedAnswers();
    expect(recorded).toHaveLength(afterCheck + run + 1);
    expect(text).not.toBe(RAW);
    expect(text).toBe(recorded.at(-1)!.replace(/\s+/g, ' ').trim());
    latencies.push(afterReleaseMs);
  }
  console.log(JSON.stringify({ raw: RAW, polished: await page.evaluate(() => window.codevo.getLastTranscript()), latenciesMs: latencies, medianMs: median(latencies) }));
  test.info().annotations.push({ type: 'polish latency', description: JSON.stringify({ latenciesMs: latencies, medianMs: median(latencies) }) });
});

test('meeting notes are written through Codex CLI', async () => {
  test.setTimeout(240_000);
  let id = '';
  await start({ aiProvider: 'codex' }, async (userData) => {
    const store = new MeetingStore(join(userData, 'meetings'), consoleLogger);
    await store.load();
    ({ id } = await store.create({ startedAt: Date.now(), systemAudio: 'recording', systemAudioNote: null }));
    await store.update(id, { durationMs: 95_000 });
    await store.finishTranscript(id, [
      { speaker: 'Ja', t0Ms: 0, t1Ms: 6_000, text: 'Dobrý deň, dnes potrebujeme rozhodnúť termín spustenia novej verzie.' },
      { speaker: 'Ostatní', t0Ms: 6_500, t1Ms: 15_000, text: 'Navrhujem piatok, testy budú hotové vo štvrtok.' },
      { speaker: 'Ja', t0Ms: 15_500, t1Ms: 24_000, text: 'Dobre, spustíme v piatok. Peter pripraví poznámky k vydaniu do štvrtka.' },
      { speaker: 'Ostatní', t0Ms: 24_500, t1Ms: 30_000, text: 'Ešte nevieme, či stihneme preklad do češtiny.' },
    ]);
  });
  await page.getByRole('tab', { name: 'Stretnutia' }).click();
  const create = page.getByRole('button', { name: 'Vytvoriť poznámky' });
  await expect(create).toBeEnabled();
  await expect(page.getByText('Poznámky vytvára Codex CLI.', { exact: false })).toBeVisible();
  await create.click();
  const shown = page.getByLabel('Poznámky zo stretnutia');
  await expect(shown).toBeVisible({ timeout: 200_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  const notes = (await page.evaluate((meetingId) => window.codevo.getMeeting(meetingId), id))?.notes ?? '';
  const [answer = ''] = await recordedAnswers();
  expect(notes).toBe(answer.trim());
  expect(notes).toMatch(/^#{1,3} Zhrnutie/m);
  test.info().annotations.push({ type: 'notes', description: notes });
  await shown.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('codex-notes.png') });
});
