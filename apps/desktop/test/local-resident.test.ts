import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalEngine } from '../src/main/engines/local-engine';
import { SettingsStore } from '../src/main/settings/settings-store';
import { ModelManager } from '../src/main/models/model-manager';
import { testEntry } from './model-fixtures';
import { pcmBytes, timelineSpeech } from './support/timeline-audio';
import type { EngineDictation } from '../src/main/engines/transcription-engine';

const BINARY = fileURLToPath(new URL('./support/resident-worker.js', import.meta.url));
let dir: string;
let settings: SettingsStore;
let local: LocalEngine;
let models: ModelManager;
let now = 0;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'resident-desktop-'));
  await mkdir(join(dir, 'models'));
  await writeFile(join(dir, 'models', 'alpha.gguf'), 'GGUF');
  await writeFile(join(dir, 'models', 'beta.gguf'), 'GGUF');
  settings = new SettingsStore(join(dir, 'settings.json'));
  await settings.load();
  await settings.update({ localModelId: 'alpha' });
  now = 0;
  models = new ModelManager({ dir: join(dir, 'models'), catalog: [testEntry('alpha', 'GGUF'), testEntry('beta', 'GGUF')], settings, warmUp: () => Promise.resolve() });
  local = new LocalEngine({ binary: BINARY, models, settings, arch: 'arm64', clock: { now: () => now } });
  vi.stubEnv('CW_WORKER_STARTS', join(dir, 'starts'));
  vi.stubEnv('CW_WORKER_CALLS', join(dir, 'calls'));
});
afterEach(async () => {
  vi.useRealTimers();
  await local.dispose();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
async function start(): Promise<EngineDictation> {
  const result = await local.prepare();
  if (!result.ready) throw new Error(`not prepared ${result.reason}`);
  return result.engine.start({ language: 'cs', signal: new AbortController().signal });
}
async function dictate(): Promise<string> {
  const dictation = await start();
  dictation.push(pcmBytes(timelineSpeech(1)));
  return dictation.finish();
}
async function lines(file: string): Promise<string[]> {
  return (await readFile(join(dir, file), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
}
function pid(text: string): number { return Number(text.split(':')[0]); }
function alive(id: number): boolean { try { process.kill(id, 0); return true; } catch { return false; } }

it('starts loading at prepare without waiting for READY and reuses the same resident for subsequent dictations', async () => {
  vi.stubEnv('CW_WORKER_LOAD_MS', '1000');
  const started = performance.now();
  const preparation = await local.prepare();
  expect(performance.now() - started).toBeLessThan(500);
  await expect.poll(() => lines('starts')).toHaveLength(1);
  if (!preparation.ready) throw new Error('not prepared');
  preparation.engine.release();
  const first = await dictate();
  const second = await dictate();
  expect(first).toMatch(/^\d+:cs:16000$/);
  expect(second).toBe(first);
  expect(alive(pid(first))).toBe(true);
  expect(await lines('starts')).toHaveLength(1);
});

it('keeps an immediate worker through recording, final inference and overlapping holds, then unloads exactly once', async () => {
  await settings.update({ localModelUnload: 'immediately' });
  vi.stubEnv('CW_WORKER_DELAY_MS', '200');
  const first = await start();
  const second = await start();
  first.push(pcmBytes(timelineSpeech(1)));
  second.push(pcmBytes(timelineSpeech(1)));
  const firstText = await first.finish();
  expect(alive(pid(firstText))).toBe(true);
  await expect(first.finish()).rejects.toMatchObject({ name: 'AbortError' });
  const pending = second.finish();
  expect(alive(pid(firstText))).toBe(true);
  expect(await pending).toBe(firstText);
  await expect.poll(() => alive(pid(firstText))).toBe(false);
  expect(pid(await dictate())).not.toBe(pid(firstText));
});

it('transfers preparation without a release gap and makes released or twice-started handles unusable', async () => {
  await settings.update({ localModelUnload: 'immediately' });
  const preparation = await local.prepare();
  if (!preparation.ready) throw new Error('not prepared');
  const controller = new AbortController();
  const options = { language: 'cs' as const, signal: controller.signal };
  const dictation = preparation.engine.start(options);
  preparation.engine.release();
  expect(() => preparation.engine.start(options)).toThrow();
  dictation.push(pcmBytes(timelineSpeech(1)));
  const text = await dictation.finish();
  controller.abort();
  await expect.poll(() => alive(pid(text))).toBe(false);
  const unused = await local.prepare();
  if (!unused.ready) throw new Error('not prepared');
  unused.engine.release();
  unused.engine.release();
  expect(() => unused.engine.start(options)).toThrow();
});


it.each([2, 5, 10, 15, 60] as const)('unloads %i minutes after recording ends and recomputes policy edits from that same end', async (minutes) => {
  const first = await dictate();
  vi.useFakeTimers();
  now += 60_000;
  await vi.advanceTimersByTimeAsync(60_000);
  await settings.update({ localModelUnload: minutes });
  const unused = await local.prepare();
  if (!unused.ready) throw new Error('not prepared');
  unused.engine.release();
  now += (minutes - 1) * 60_000 - 1;
  await vi.advanceTimersByTimeAsync((minutes - 1) * 60_000 - 1);
  expect(alive(pid(first))).toBe(true);
  now += 1;
  await vi.advanceTimersByTimeAsync(1);
  vi.useRealTimers();
  await expect.poll(() => alive(pid(first))).toBe(false);
});

it('never unloads until policy changes, with the old recording-end anchor retained', async () => {
  await settings.update({ localModelUnload: 'never' });
  const text = await dictate();
  vi.useFakeTimers();
  now += 61 * 60_000;
  await vi.advanceTimersByTimeAsync(61 * 60_000);
  expect(alive(pid(text))).toBe(true);
  await settings.update({ localModelUnload: 5 });
  vi.useRealTimers();
  await expect.poll(() => alive(pid(text))).toBe(false);
});

it('model changes stop a recording worker immediately and old handles cannot stop its replacement', async () => {
  const first = await dictate();
  const recording = await start();
  recording.push(pcmBytes(timelineSpeech(1)));
  const unused = await local.prepare();
  await settings.update({ localModelId: 'beta' });
  await expect.poll(() => alive(pid(first))).toBe(false);
  await expect(recording.finish()).rejects.toMatchObject({ name: 'AbortError' });
  const replacement = await dictate();
  expect(pid(replacement)).not.toBe(pid(first));
  if (!unused.ready) throw new Error('not prepared');
  unused.engine.release();
  expect(() => unused.engine.start({ language: 'sk', signal: new AbortController().signal })).toThrow();
  expect(alive(pid(replacement))).toBe(true);
  await settings.update({ localModelId: null });
  await expect.poll(() => alive(pid(replacement))).toBe(false);
});

it('reserves demand during async preflight and excludes stale A-to-B-to-A preparations', async () => {
  const first = await dictate();
  let unblock = () => {};
  const barrier = new Promise<void>((resolve) => { unblock = resolve; });
  await local.dispose();
  local = new LocalEngine({
    binary: BINARY, settings, arch: 'arm64', clock: { now: () => now },
    models: {
      activeModelPath: () => models.activeModelPath(),
      activeLanguageHint: () => models.activeLanguageHint(),
      verifyActive: async () => { await barrier; return models.verifyActive(); },
    },
  });
  const pending = local.prepare();
  await settings.update({ localModelId: 'beta' });
  await settings.update({ localModelId: 'alpha' });
  unblock();
  expect(await pending).toEqual({ ready: false, reason: 'no-model' });
  expect(alive(pid(first))).toBe(false);
  expect(await lines('starts')).toHaveLength(1);
  expect(await local.prepare()).toMatchObject({ ready: true });
});

it('defers acceleration edits through active holds then uses the latest preference', async () => {
  await local.dispose();
  local = new LocalEngine({ binary: BINARY, models, settings, arch: 'x64', platform: 'darwin' });
  const first = await dictate();
  const recording = await start();
  await settings.update({ localAcceleration: 'gpu' });
  expect(alive(pid(first))).toBe(true);
  recording.push(pcmBytes(timelineSpeech(1)));
  expect(await recording.finish()).toBe(first);
  await expect.poll(() => alive(pid(first))).toBe(false);
  const second = await dictate();
  const starts = (await lines('starts')).map((line) => JSON.parse(line) as { args: string[] });
  expect(starts.map(({ args }) => args[args.indexOf('--backend') + 1])).toEqual(['cpu', 'metal']);
  expect(pid(second)).not.toBe(pid(first));
});

it('warms with one second of silence on the same resident used for dictation and rejects stale expected paths', async () => {
  await local.warmUp(join(dir, 'models', 'alpha.gguf'));
  const text = await dictate();
  const calls = (await lines('calls')).map((line) => JSON.parse(line) as { pid: number; language: string; samples: number });
  expect(calls).toMatchObject([{ pid: pid(text), language: 'en', samples: 16000, nonzero: false }, { pid: pid(text), language: 'cs', samples: 16000, nonzero: true }]);
  await expect(local.warmUp(join(dir, 'models', 'beta.gguf'))).rejects.toThrow();
  expect(await lines('starts')).toHaveLength(1);
});

it('rejects a warmup superseded during readiness, including ABA, and cannot resurrect its worker', async () => {
  vi.stubEnv('CW_WORKER_LOAD_MS', '300');
  const warmed = local.warmUp(join(dir, 'models', 'alpha.gguf')).then(() => 'success', () => 'stale');
  await expect.poll(() => lines('starts')).toHaveLength(1);
  await settings.update({ localModelId: 'beta' });
  await settings.update({ localModelId: 'alpha' });
  expect(await warmed).toBe('stale');
  expect(await lines('calls')).toEqual([]);
  expect(await lines('starts')).toHaveLength(1);
});

it('reserves the current worker synchronously while preflight verification is pending past the idle deadline', async () => {
  await local.dispose();
  let verification: Promise<void> = Promise.resolve();
  local = new LocalEngine({
    binary: BINARY, settings, arch: 'arm64', clock: { now: () => now },
    models: {
      activeModelPath: () => models.activeModelPath(),
      activeLanguageHint: () => models.activeLanguageHint(),
      verifyActive: async () => { await verification; return models.verifyActive(); },
    },
  });
  const text = await dictate();
  const gate = Promise.withResolvers<void>();
  verification = gate.promise;
  const pending = local.prepare();
  now = 6 * 60_000;
  await settings.update({ localModelUnload: 2 });
  expect(alive(pid(text))).toBe(true);
  gate.resolve();
  const prepared = await pending;
  if (!prepared.ready) throw new Error('not prepared');
  prepared.engine.release();
  await expect.poll(() => alive(pid(text))).toBe(false);
});

it('holds recording and final inference past an idle deadline and never starts a fresh interval at inference completion', async () => {
  vi.stubEnv('CW_WORKER_DELAY_MS', '200');
  const first = await dictate();
  const dictation = await start();
  dictation.push(pcmBytes(timelineSpeech(1)));
  now = 10 * 60_000;
  await settings.update({ localModelUnload: 2 });
  expect(alive(pid(first))).toBe(true);
  const finishing = dictation.finish();
  now += 3 * 60_000;
  await settings.update({ localModelUnload: 5 });
  expect(alive(pid(first))).toBe(true);
  now += 3 * 60_000;
  await settings.update({ localModelUnload: 2 });
  expect(alive(pid(first))).toBe(true);
  expect(await finishing).toBe(first);
  await expect.poll(() => alive(pid(first))).toBe(false);
});

it('releases a failed dictation and an abort/finish race once without affecting overlapping recording', async () => {
  await settings.update({ localModelUnload: 'immediately' });
  vi.stubEnv('CW_WORKER_FAIL', '1');
  const keeper = await start();
  const failed = await start();
  failed.push(pcmBytes(timelineSpeech(1)));
  await expect(failed.finish()).rejects.toMatchObject({ reason: 'engine-failed' });
  const starts = (await lines('starts')).map((line) => JSON.parse(line) as { pid: number });
  const id = starts[0]?.pid ?? 0;
  expect(alive(id)).toBe(true);
  const controller = new AbortController();
  const prepared = await local.prepare();
  if (!prepared.ready) throw new Error('not prepared');
  const cancelled = prepared.engine.start({ language: 'sk', signal: controller.signal });
  cancelled.push(pcmBytes(timelineSpeech(1)));
  const terminal = cancelled.finish().catch((error: unknown) => error);
  controller.abort();
  expect(await terminal).toMatchObject({ name: 'AbortError' });
  expect(alive(id)).toBe(true);
  await keeper.finish();
  await expect.poll(() => alive(id)).toBe(false);
});

it('disposal invalidates pending verification and closes a loading child before returning', async () => {
  vi.stubEnv('CW_WORKER_LOAD_MS', '1000');
  expect(await local.prepare()).toMatchObject({ ready: true });
  await expect.poll(() => lines('starts')).toHaveLength(1);
  const starts = (await lines('starts')).map((line) => JSON.parse(line) as { pid: number });
  await local.dispose();
  expect(alive(starts[0]?.pid ?? 0)).toBe(false);
  expect(await local.prepare()).toEqual({ ready: false, reason: 'no-model' });
  expect(await lines('starts')).toHaveLength(1);
});

it('retains the latest recording end across overlapping finals without extending it when an older final completes', async () => {
  await settings.update({ localModelUnload: 2 });
  vi.stubEnv('CW_WORKER_DELAY_MS', '100');
  const first = await start();
  const second = await start();
  first.push(pcmBytes(timelineSpeech(1)));
  second.push(pcmBytes(timelineSpeech(1)));
  const older = first.finish();
  now = 1000;
  const newer = second.finish();
  now = 120_500;
  const [text] = await Promise.all([older, newer]);
  expect(alive(pid(text ?? ''))).toBe(true);
  now = 121_000;
  await settings.update({ localModelUnload: 2 });
  await expect.poll(() => alive(pid(text ?? ''))).toBe(false);
});

it('warmup cannot renew a deadline established by real dictation', async () => {
  const text = await dictate();
  now = 4 * 60_000;
  await local.warmUp(join(dir, 'models/alpha.gguf'));
  now = 5 * 60_000;
  await settings.update({ localModelUnload: 5 });
  await expect.poll(() => alive(pid(text))).toBe(false);
});

it('shares one startup failure across queued jobs and retries only on later preparation', async () => {
  vi.stubEnv('CW_WORKER_LOAD_FAIL', '1');
  vi.stubEnv('CW_WORKER_LOAD_MS', '100');
  const first = await start();
  const second = await start();
  first.push(pcmBytes(timelineSpeech(1)));
  second.push(pcmBytes(timelineSpeech(1)));
  const outcomes = await Promise.allSettled([first.finish(), second.finish()]);
  expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
  expect(await lines('starts')).toHaveLength(1);
  expect(await lines('calls')).toEqual([]);
  vi.stubEnv('CW_WORKER_LOAD_FAIL', '0');
  expect(await dictate()).toMatch(/^\d+:cs:16000$/);
  expect(await lines('starts')).toHaveLength(2);
});
