import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalEngine } from '../src/main/engines/local-engine';
import type { CatalogEntry } from '../src/main/models/catalog-entry';
import { loadCatalog } from '../src/main/models/model-catalog';
import { ModelManager } from '../src/main/models/model-manager';
import { SettingsStore } from '../src/main/settings/settings-store';
import { PCM_BYTES_PER_SECOND, PCM_SAMPLE_RATE } from '../src/shared/pcm';
import { FAKE_CLI, readRecordedCalls } from '../../../packages/stt-runner/test/support/fake-cli';
import { abortWhenProcessSettles } from '../../../packages/stt-runner/test/support/late-abort';
import { sha256Of, testEntry } from './model-fixtures';

const MODEL_BODY = 'GGUF';
const BUNDLED_CATALOG = fileURLToPath(new URL('../resources/model-catalog.json', import.meta.url));

let scratch: string;
let argsFile: string;
let modelsDir: string;
let modelFile: string;
let settings: SettingsStore;

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
  return new LocalEngine({ binary: FAKE_CLI, models: models(), settings, arch: 'arm64', ...overrides });
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
    await expect(canary.transcribe(secondStampedPcm(1), 'auto', new AbortController().signal)).rejects.toMatchObject({ reason: 'language-required' });
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

  it('transcribes 5 minutes in ordered chunks', async () => {
    vi.stubEnv('FAKE_CLI_MODE', 'echo-chunk');

    const text = await engine().transcribe(secondStampedPcm(300), 'sk', new AbortController().signal);

    const chunks = text.split(' ').map((part) => part.split(':').map(Number));
    expect(chunks.map(([startSecond]) => startSecond)).toEqual([0, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275]);
    expect(chunks.every(([, bytes]) => (bytes ?? Infinity) <= 25 * PCM_BYTES_PER_SECOND)).toBe(true);
    const calls = await readRecordedCalls(argsFile);
    expect(calls).toHaveLength(12);
    expect(calls.every((call) => argValue(call, '--model') === modelFile && argValue(call, '--language') === 'sk')).toBe(true);
  });

  it('skips chunks that come back empty', async () => {
    vi.stubEnv('FAKE_CLI_MODE', 'echo-chunk');
    const pcm = secondStampedPcm(60);
    const view = new DataView(pcm.buffer);
    view.setInt16(25 * PCM_BYTES_PER_SECOND, -1, true);

    const text = await engine().transcribe(pcm, 'en', new AbortController().signal);

    expect(text).toBe(`0:${25 * PCM_BYTES_PER_SECOND} 50:${10 * PCM_BYTES_PER_SECOND}`);
  });

  it('returns an empty transcript for audio too short to transcribe', async () => {
    await expect(engine().transcribe(new Uint8Array(100), 'sk', new AbortController().signal)).resolves.toBe('');
    await expect(readRecordedCalls(argsFile)).resolves.toEqual([]);
  });

  it('passes the language through', async () => {
    await engine().transcribe(secondStampedPcm(1), 'cs', new AbortController().signal);

    const [call] = await readRecordedCalls(argsFile);
    expect(argValue(call, '--language')).toBe('cs');
  });

  it('uses metal on arm64 and cpu on x64', async () => {
    await engine({ arch: 'arm64' }).transcribe(secondStampedPcm(1), 'sk', new AbortController().signal);
    await engine({ arch: 'x64' }).transcribe(secondStampedPcm(1), 'sk', new AbortController().signal);

    const calls = await readRecordedCalls(argsFile);
    expect(calls.map((call) => argValue(call, '--backend'))).toEqual(['metal', 'cpu']);
  });

  it('rejects when no model is active', async () => {
    await settings.update({ localModelId: null });

    await expect(engine().transcribe(secondStampedPcm(1), 'sk', new AbortController().signal)).rejects.toMatchObject({ reason: 'no-model' });
  });

  it('stops on abort', async () => {
    vi.stubEnv('FAKE_CLI_MODE', 'hang');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);

    await expect(engine().transcribe(secondStampedPcm(300), 'sk', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

    await expect(readRecordedCalls(argsFile)).resolves.toHaveLength(1);
  });

  it('returns no text when aborted after the last chunk finished', async () => {
    const controller = abortWhenProcessSettles();

    await expect(engine().transcribe(secondStampedPcm(1), 'sk', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(readRecordedCalls(argsFile)).resolves.toHaveLength(1);
  });

  it('does not start when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(engine().transcribe(secondStampedPcm(30), 'sk', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(readRecordedCalls(argsFile)).resolves.toEqual([]);
  });
});
