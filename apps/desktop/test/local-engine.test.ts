import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalEngine } from '../src/main/engines/local-engine';
import type { Preparation } from '../src/main/engines/transcription-engine';
import type { CatalogEntry } from '../src/main/models/catalog-entry';
import { loadCatalog } from '../src/main/models/model-catalog';
import { ModelManager } from '../src/main/models/model-manager';
import { SettingsStore } from '../src/main/settings/settings-store';
import { PCM_BYTES_PER_SECOND, PCM_SAMPLE_RATE } from '../src/shared/pcm';
import { FAKE_WORKER, readRecordedCalls } from './support/resident-fixture';
import { sha256Of, testEntry } from './model-fixtures';
import { expectedText, joinSamples, pcmBytes, timelineSilence, timelineSpeech, writeTimeline } from './support/timeline-audio';
import type { Language } from '../src/shared/settings';

const MODEL_BODY = 'GGUF';
const FAKE_TIMELINE_CLI = fileURLToPath(new URL('./support/resident-worker.js', import.meta.url));
const BUNDLED_CATALOG = fileURLToPath(new URL('../resources/model-catalog.json', import.meta.url));

let scratch: string;
let argsFile: string;
let modelsDir: string;
let modelFile: string;
let settings: SettingsStore;
const engines: LocalEngine[] = [];

function secondStampedPcm(totalSeconds: number): Uint8Array {
  const pcm = new Uint8Array(totalSeconds * PCM_BYTES_PER_SECOND);
  const view = new DataView(pcm.buffer);
  for (let sample = 0; sample < totalSeconds * PCM_SAMPLE_RATE; sample += 1) {
    view.setInt16(sample * 2, Math.floor(sample / PCM_SAMPLE_RATE), true);
  }
  return pcm;
}

function models(catalog: CatalogEntry[] = [testEntry('alpha', MODEL_BODY)]): ModelManager {
  return new ModelManager({ dir: modelsDir, catalog, settings, warmUp: () => Promise.resolve() });
}

function engine(overrides: Partial<ConstructorParameters<typeof LocalEngine>[0]> = {}): LocalEngine {
  const local = new LocalEngine({ binary: FAKE_WORKER, models: models(), settings, arch: 'arm64', platform: 'darwin', ...overrides });
  engines.push(local);
  return local;
}

async function activateBundled(id: string): Promise<ModelManager> {
  const entries = loadCatalog(BUNDLED_CATALOG)
    .models.filter((entry) => entry.id === id)
    .map((entry) => ({ ...entry, sizeBytes: MODEL_BODY.length, sha256: sha256Of(MODEL_BODY) }));
  expect(entries).toHaveLength(1);
  await writeFile(join(modelsDir, `${id}.gguf`), MODEL_BODY);
  await settings.update({ localModelId: id });
  return models(entries);
}

async function useTimeline(samples: Int16Array): Promise<void> {
  await writeTimeline(join(scratch, 'source.pcm'), samples);
  vi.stubEnv('FAKE_TIMELINE_SOURCE', join(scratch, 'source.pcm'));
  vi.stubEnv('FAKE_TIMELINE_JOBS', join(scratch, 'jobs.txt'));
}

async function dictate(local: LocalEngine, audio: Uint8Array | Int16Array, language: Language, signal = new AbortController().signal): Promise<string> {
  const preparation = await local.prepare();
  expect(preparation.ready).toBe(true);
  const dictation = (preparation as Extract<Preparation, { ready: true }>).engine.start({ language, signal });
  const pcm = audio instanceof Int16Array ? pcmBytes(audio) : audio;
  for (let start = 0; start < pcm.byteLength; start += PCM_BYTES_PER_SECOND) {
    dictation.push(pcm.subarray(start, start + PCM_BYTES_PER_SECOND));
  }
  return dictation.finish();
}

function argValue(call: string[] | undefined, flag: string): string | undefined {
  return call?.[call.indexOf(flag) + 1];
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-local-engine-'));
  argsFile = join(scratch, 'args.txt');
  modelsDir = join(scratch, 'models');
  modelFile = join(modelsDir, 'alpha.gguf');
  await mkdir(modelsDir);
  await writeFile(modelFile, MODEL_BODY);
  settings = new SettingsStore(join(scratch, 'settings.json'));
  await settings.load();
  await settings.update({ localModelId: 'alpha', language: 'sk' });
  vi.stubEnv('FAKE_CLI_ARGS_FILE', argsFile);
});

afterEach(async () => {
  await Promise.all(engines.splice(0).map((local) => local.dispose()));
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

describe('LocalEngine', () => {
  it('is the local engine', () => {
    expect(engine().id).toBe('local');
  });

  it('is ready with a verified model and an executable binary', async () => {
    await expect(engine().isReady()).resolves.toEqual({ ready: true });
  });

  it('reports no-model when none is active', async () => {
    await settings.update({ localModelId: null });

    await expect(engine().isReady()).resolves.toEqual({ ready: false, reason: 'no-model' });
  });

  it('reports a missing model', async () => {
    await rm(modelFile);

    await expect(engine().isReady()).resolves.toEqual({ ready: false, reason: 'model-missing' });
  });

  it('reports a broken model', async () => {
    await writeFile(modelFile, '');

    await expect(engine().isReady()).resolves.toEqual({ ready: false, reason: 'model-broken' });
  });

  it('canary with language auto is not ready with language-required', async () => {
    const canary = engine({ models: await activateBundled('canary-1b-v2-q8') });
    await settings.update({ language: 'auto' });

    await expect(canary.isReady()).resolves.toEqual({ ready: false, reason: 'language-required' });
    await expect(canary.prepare()).resolves.toEqual({ ready: false, reason: 'language-required' });
    await expect(readRecordedCalls(argsFile)).resolves.toEqual([]);

    await settings.update({ language: 'sk' });
    await expect(canary.isReady()).resolves.toEqual({ ready: true });
  });

  it('allows automatic language with parakeet and whisper', async () => {
    await settings.update({ language: 'auto' });

    await expect(engine({ models: await activateBundled('parakeet-ultra-q8') }).isReady()).resolves.toEqual({ ready: true });
    await expect(engine({ models: await activateBundled('tc-whisper-turbo-q8') }).isReady()).resolves.toEqual({ ready: true });
  });

  it('reports a missing or non-executable binary', async () => {
    const notExecutable = join(scratch, 'transcribe-cli');
    await writeFile(notExecutable, '#!/bin/sh\n');
    await chmod(notExecutable, 0o644);

    await expect(engine({ binary: join(scratch, 'missing') }).isReady()).resolves.toEqual({ ready: false, reason: 'binary-missing' });
    await expect(engine({ binary: notExecutable }).isReady()).resolves.toEqual({ ready: false, reason: 'binary-missing' });
  });

  it('streams a long dictation in segments of at most 25 seconds', async () => {
    const samples = joinSamples(timelineSpeech(30), timelineSilence(30, 1), timelineSpeech(20, 2));
    await useTimeline(samples);

    const text = await dictate(engine({ binary: FAKE_TIMELINE_CLI }), samples, 'sk');

    expect(text).toBe(expectedText(samples));
    const calls = await readRecordedCalls(argsFile);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((call) => argValue(call, '--model') === modelFile && argValue(call, '--language') === 'sk')).toBe(true);
    const jobs = (await readFile(join(scratch, 'jobs.txt'), 'utf8')).trim().split('\n').map((line) => Number(line.split(' ')[1]));
    expect(jobs.every((samplesInJob) => samplesInJob <= 25 * PCM_SAMPLE_RATE)).toBe(true);
  });

  it('returns an empty transcript for audio too short to transcribe', async () => {
    await expect(dictate(engine(), new Uint8Array(100), 'sk')).resolves.toBe('');
    await expect(readRecordedCalls(argsFile)).resolves.toEqual([]);
  });

  it('passes the language through', async () => {
    await dictate(engine(), secondStampedPcm(1), 'cs');

    const [call] = await readRecordedCalls(argsFile);
    expect(argValue(call, '--language')).toBe('cs');
  });

  it('uses metal on arm64 and cpu on x64', async () => {
    await dictate(engine({ arch: 'arm64' }), secondStampedPcm(1), 'sk');
    await dictate(engine({ arch: 'x64' }), secondStampedPcm(1), 'sk');

    const calls = await readRecordedCalls(argsFile);
    expect(calls.map((call) => argValue(call, '--backend'))).toEqual(['metal', 'cpu']);
  });

  it('is not prepared when no model is active', async () => {
    await settings.update({ localModelId: null });

    await expect(engine().prepare()).resolves.toEqual({ ready: false, reason: 'no-model' });
  });

  it('stops on abort', async () => {
    vi.stubEnv('FAKE_CLI_MODE', 'hang');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);

    await expect(dictate(engine(), secondStampedPcm(3), 'sk', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

    await expect(readRecordedCalls(argsFile)).resolves.toHaveLength(1);
  });

  it('does not start when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(dictate(engine(), secondStampedPcm(30), 'sk', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(readRecordedCalls(argsFile)).resolves.toEqual([]);
  });
});
