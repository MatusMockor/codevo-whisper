import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalEngine } from '../src/main/engines/local-engine';
import type { Preparation } from '../src/main/engines/transcription-engine';
import { createLanguagePack, type LanguagePack } from '../src/main/models/language-pack';
import { ModelManager } from '../src/main/models/model-manager';
import { SettingsStore } from '../src/main/settings/settings-store';
import type { LanguageSelection } from '../src/shared/dictation-languages';
import { PCM_BYTES_PER_SECOND } from '../src/shared/pcm';
import { testEntry } from './model-fixtures';
import { RecordingLogger } from './recording-logger';

const BINARY = fileURLToPath(new URL('./support/routed-worker.js', import.meta.url));
const PARAKEET = testEntry('parakeet', 'GGUF-parakeet');
const CANARY = testEntry('canary', 'GGUF-canary', { languageHint: 'required' });
const WHISPER = testEntry('whisper', 'GGUF-whisper', { languageHint: 'optional' });
const LANGUAGE_ID = testEntry('langid', 'GGUF-langid', { roles: ['language-id'], roleLabels: ['Rozpoznávanie jazyka'] });
const SK_CS: LanguageSelection = { mode: 'selected', selected: ['sk', 'cs'] };
const AUTO: LanguageSelection = { mode: 'auto', selected: ['sk', 'cs'] };
const CYRILLIC = 'привіт світ';
const CONFIDENT_CS = { FAKE_WORKER_LID_TOP: 'cs', FAKE_WORKER_LID_P: '0.995' };

type Start = { pid: number; model: string; backend: string };

let dir: string;
let settings: SettingsStore;
let models: ModelManager;
let local: LocalEngine;
let now = 0;

function languagePack(): LanguagePack {
  return createLanguagePack({
    dir: join(dir, 'models'),
    conditioned: CANARY,
    languageId: LANGUAGE_ID,
    models,
    requiredRamBytes: 1024,
    totalMemory: () => 4096,
    settings,
    logger: new RecordingLogger(),
  });
}

function engine(overrides: Partial<ConstructorParameters<typeof LocalEngine>[0]> = {}): LocalEngine {
  return new LocalEngine({ binary: BINARY, models, languagePack: languagePack(), settings, arch: 'arm64', platform: 'darwin', clock: { now: () => now }, ...overrides });
}

async function writeModel(id: string, body: string): Promise<void> {
  await writeFile(join(dir, 'models', `${id}.gguf`), body);
}

async function installPack(): Promise<void> {
  await writeModel('canary', 'GGUF-canary');
  await writeModel('langid', 'GGUF-langid');
}

async function starts(): Promise<Start[]> {
  const text = await readFile(join(dir, 'starts'), 'utf8').catch(() => '');
  return text
    .trim()
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Start);
}

function modelsOf(list: readonly Start[]): string[] {
  return list.map((start) => start.model).sort();
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function prepared(preparation: Preparation): Extract<Preparation, { ready: true }>['engine'] {
  expect(preparation.ready).toBe(true);
  return (preparation as Extract<Preparation, { ready: true }>).engine;
}

async function dictate(languages: LanguageSelection = SK_CS, seconds = 1): Promise<string> {
  const dictation = prepared(await local.prepare()).start({ languages, signal: new AbortController().signal });
  dictation.push(new Uint8Array(seconds * PCM_BYTES_PER_SECOND));
  return dictation.finish();
}

function stubWorkers(env: Readonly<Record<string, string>>): void {
  Object.entries(env).forEach(([name, value]) => vi.stubEnv(name, value));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-routed-'));
  await mkdir(join(dir, 'models'));
  await writeModel('parakeet', 'GGUF-parakeet');
  settings = new SettingsStore(join(dir, 'settings.json'));
  await settings.load();
  await settings.update({ localModelId: 'parakeet', languages: SK_CS });
  models = new ModelManager({ dir: join(dir, 'models'), catalog: [PARAKEET, CANARY], settings, warmUp: () => Promise.resolve() });
  now = 0;
  local = engine();
  vi.stubEnv('CW_ROUTED_STARTS', join(dir, 'starts'));
});

afterEach(async () => {
  vi.useRealTimers();
  await local.dispose();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('LocalEngine readiness for selected languages', () => {
  it('reports languages-pack-missing until both pack files are present and verified', async () => {
    await expect(local.isReady()).resolves.toEqual({ ready: false, reason: 'languages-pack-missing' });
    await expect(local.prepare()).resolves.toEqual({ ready: false, reason: 'languages-pack-missing' });

    await writeModel('canary', 'GGUF-canary');
    await expect(local.isReady()).resolves.toEqual({ ready: false, reason: 'languages-pack-missing' });

    await writeModel('langid', 'GGUF-langid');
    await expect(local.isReady()).resolves.toEqual({ ready: true });

    await writeModel('langid', 'GGUF-broken');
    await expect(local.isReady()).resolves.toEqual({ ready: false, reason: 'languages-pack-missing' });
    expect(await starts()).toEqual([]);
  });

  it('never asks for the pack in automatic mode', async () => {
    await settings.update({ languages: AUTO });

    await expect(local.isReady()).resolves.toEqual({ ready: true });
    await expect(dictate(AUTO)).resolves.toMatch(/^\d+:auto:16000$/);
    expect(modelsOf(await starts())).toEqual(['parakeet']);
  });

  it('keeps canary as the active model on its primary language without language ID', async () => {
    await installPack();
    await settings.update({ localModelId: 'canary', languages: { mode: 'selected', selected: ['de', 'sk'] } });

    await expect(dictate({ mode: 'selected', selected: ['de', 'sk'] })).resolves.toMatch(/^\d+:de:16000$/);
    expect(modelsOf(await starts())).toEqual(['canary']);
  });
});

describe('LocalEngine routed generation', () => {
  beforeEach(async () => {
    await installPack();
  });

  it('loads the verbatim model, canary and language ID as three residents on the local backend', async () => {
    stubWorkers({ ...CONFIDENT_CS, CW_MODEL_REPLIES: JSON.stringify({ parakeet: CYRILLIC }) });

    await expect(dictate()).resolves.toMatch(/^\d+:cs:16000$/);

    const spawned = await starts();
    expect(modelsOf(spawned)).toEqual(['canary', 'langid', 'parakeet']);
    expect(spawned.every((start) => start.backend === 'metal')).toBe(true);
    await expect(dictate()).resolves.toMatch(/^\d+:cs:16000$/);
    expect(await starts()).toHaveLength(3);
  });

  it('keeps confidently foreign speech verbatim instead of translating it', async () => {
    stubWorkers({ FAKE_WORKER_LID_TOP: 'de', FAKE_WORKER_LID_P: '0.995' });

    await expect(dictate()).resolves.toMatch(/^\d+:auto:16000$/);
  });

  it('keeps unsure speech verbatim when its spelling fits the selected languages', async () => {
    stubWorkers({ FAKE_WORKER_LID_TOP: 'sk', FAKE_WORKER_LID_P: '0.6' });

    await expect(dictate()).resolves.toMatch(/^\d+:auto:16000$/);
  });

  it('keeps segments under 500 ms verbatim', async () => {
    stubWorkers(CONFIDENT_CS);

    const dictation = prepared(await local.prepare()).start({ languages: SK_CS, signal: new AbortController().signal });
    dictation.push(new Uint8Array(PCM_BYTES_PER_SECOND / 4));

    await expect(dictation.finish()).resolves.toMatch(/^\d+:auto:4000$/);
  });

  it('serves an automatic session on a routed preparation without language ID', async () => {
    stubWorkers({ ...CONFIDENT_CS, CW_MODEL_REPLIES: JSON.stringify({ parakeet: CYRILLIC }) });

    const dictation = prepared(await local.prepare()).start({ languages: AUTO, signal: new AbortController().signal });
    dictation.push(new Uint8Array(PCM_BYTES_PER_SECOND));

    await expect(dictation.finish()).resolves.toBe(CYRILLIC);
  });

  it('keeps language ID on the CPU when the transcription models use the accelerator', async () => {
    local = engine({ platform: 'linux', acceleratorBinary: BINARY });
    stubWorkers({ ...CONFIDENT_CS, CW_MODEL_REPLIES: JSON.stringify({ parakeet: CYRILLIC }) });

    await expect(dictate()).resolves.toMatch(/^\d+:cs:16000$/);

    const backends = Object.fromEntries((await starts()).map((start) => [start.model, start.backend]));
    expect(backends).toEqual({ parakeet: 'auto', canary: 'auto', langid: 'cpu' });
  });

  it('warms all three residents and dictates on them without another start', async () => {
    stubWorkers(CONFIDENT_CS);

    await local.warmUp(join(dir, 'models', 'parakeet.gguf'));

    expect(modelsOf(await starts())).toEqual(['canary', 'langid', 'parakeet']);
    await dictate();
    expect(await starts()).toHaveLength(3);
  });

  it('unloads all three residents once the idle policy expires', async () => {
    stubWorkers(CONFIDENT_CS);
    await settings.update({ localModelUnload: 2 });
    await dictate();
    const pids = (await starts()).map((start) => start.pid);
    expect(pids.every(alive)).toBe(true);

    now += 2 * 60_000;
    await settings.update({ localModelUnload: 2 });

    await expect.poll(() => pids.some(alive)).toBe(false);
  });

  it('unloads all three residents right after the dictation with the immediate policy', async () => {
    stubWorkers(CONFIDENT_CS);
    await settings.update({ localModelUnload: 'immediately' });

    await dictate();

    const pids = (await starts()).map((start) => start.pid);
    await expect.poll(() => pids.some(alive)).toBe(false);
  });

  it('retires the routed residents when the next dictation is automatic', async () => {
    stubWorkers(CONFIDENT_CS);
    await dictate();
    const routed = (await starts()).map((start) => start.pid);

    await settings.update({ languages: AUTO });
    await expect(dictate(AUTO)).resolves.toMatch(/^\d+:auto:16000$/);

    await expect.poll(() => routed.some(alive)).toBe(false);
    expect(modelsOf((await starts()).slice(3))).toEqual(['parakeet']);
  });

  it('replaces a direct worker with the routed residents once the pack is downloaded', async () => {
    await rm(join(dir, 'models', 'langid.gguf'));
    await local.warmUp(join(dir, 'models', 'parakeet.gguf'));
    const [direct] = await starts();
    await installPack();
    stubWorkers({ ...CONFIDENT_CS, CW_MODEL_REPLIES: JSON.stringify({ parakeet: CYRILLIC }) });

    await expect(dictate()).resolves.toMatch(/^\d+:cs:16000$/);

    await expect.poll(() => alive(direct?.pid ?? 0)).toBe(false);
    expect(modelsOf((await starts()).slice(1))).toEqual(['canary', 'langid', 'parakeet']);
  });

  it('lets a stale preparation finish without closing the residents of the model that replaced it', async () => {
    stubWorkers({ ...CONFIDENT_CS, CW_MODEL_REPLIES: JSON.stringify({ whisper: CYRILLIC }) });
    await writeModel('whisper', 'GGUF-whisper');
    models = new ModelManager({ dir: join(dir, 'models'), catalog: [PARAKEET, WHISPER, CANARY], settings, warmUp: () => Promise.resolve() });
    const gate = Promise.withResolvers<void>();
    let verifications = 0;
    await local.dispose();
    local = engine({
      models: {
        activeModelPath: () => models.activeModelPath(),
        activeLanguageHint: () => models.activeLanguageHint(),
        verifyActive: async () => {
          verifications += 1;
          if (verifications === 1) await gate.promise;
          return models.verifyActive();
        },
      },
    });
    const stale = local.prepare();
    await expect.poll(() => verifications).toBe(1);
    await settings.update({ localModelId: 'whisper' });
    const recording = prepared(await local.prepare()).start({ languages: SK_CS, signal: new AbortController().signal });
    recording.push(new Uint8Array(PCM_BYTES_PER_SECOND));

    gate.resolve();

    await expect(stale).resolves.toEqual({ ready: false, reason: 'no-model' });
    await expect(recording.finish()).resolves.toMatch(/^\d+:cs:16000$/);
    expect(modelsOf(await starts())).toEqual(['canary', 'langid', 'whisper']);
  });

  it('settles overlapping preparations across a mode change on one generation at a time', async () => {
    stubWorkers({ ...CONFIDENT_CS, CW_MODEL_REPLIES: JSON.stringify({ parakeet: CYRILLIC }) });
    await settings.update({ languages: AUTO });
    const direct = local.prepare();
    await settings.update({ languages: SK_CS });
    const routed = local.prepare();

    const [first, second] = await Promise.all([direct, routed]);

    expect(second.ready).toBe(true);
    const dictation = prepared(second).start({ languages: SK_CS, signal: new AbortController().signal });
    dictation.push(new Uint8Array(PCM_BYTES_PER_SECOND));
    await expect(dictation.finish()).resolves.toMatch(/^\d+:cs:16000$/);
    if (first.ready) first.engine.release();
    const spawned = await starts();
    await expect.poll(() => modelsOf(spawned.filter((start) => alive(start.pid)))).toEqual(['canary', 'langid', 'parakeet']);
  });

  it('lets a selected preparation that waited for the pack follow a switch to Automaticky without closing the direct dictation', async () => {
    const pack = languagePack();
    const gate = Promise.withResolvers<void>();
    let lookups = 0;
    await local.dispose();
    local = engine({
      languagePack: {
        paths: async () => {
          lookups += 1;
          if (lookups === 1) await gate.promise;
          return pack.paths();
        },
      },
    });
    const selected = local.prepare();
    await expect.poll(() => lookups).toBe(1);
    await settings.update({ languages: AUTO });
    const recording = prepared(await local.prepare()).start({ languages: AUTO, signal: new AbortController().signal });
    recording.push(new Uint8Array(PCM_BYTES_PER_SECOND));

    gate.resolve();
    const late = prepared(await selected);

    await expect(recording.finish()).resolves.toMatch(/^\d+:auto:16000$/);
    late.release();
    expect(modelsOf(await starts())).toEqual(['parakeet']);
  });
});
