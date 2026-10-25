import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogEntry } from '../src/main/models/catalog-entry';
import { ModelManager } from '../src/main/models/model-manager';
import { PROGRESS_INTERVAL_MS } from '../src/main/models/model-state-board';
import { SettingsStore } from '../src/main/settings/settings-store';
import type { ModelState } from '../src/shared/models';
import { FakeHuggingFace, type FakeFile } from './fake-hugging-face';
import { modelUrlPath, testEntry } from './model-fixtures';
import { RecordingLogger } from './recording-logger';

const PAYLOAD_BYTES = 256 * 1024;
const HALF = PAYLOAD_BYTES / 2;

let scratch: string;
let modelsDir: string;
let settings: SettingsStore;
let server: FakeHuggingFace;
let payload: Buffer;
let warmUps: string[];

function serve(id: string, file: Partial<FakeFile> = {}): void {
  server.serve(modelUrlPath(id), { body: payload, ...file });
}

function manager(catalog: CatalogEntry[] = [testEntry('alpha', payload), testEntry('beta', payload)]): ModelManager {
  return new ModelManager({
    dir: modelsDir,
    catalog,
    settings,
    fetchImpl: server.fetchImpl,
    warmUp: (path) => {
      warmUps.push(path);
      return Promise.resolve();
    },
  });
}

function stateOf(models: ModelManager, id: string): ModelState | undefined {
  return models.states().find((state) => state.id === id);
}

async function listModels(): Promise<string[]> {
  return (await readdir(modelsDir).catch(() => [])).sort();
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-models-'));
  modelsDir = join(scratch, 'models');
  settings = new SettingsStore(join(scratch, 'settings.json'));
  await settings.load();
  server = new FakeHuggingFace();
  await server.start();
  payload = randomBytes(PAYLOAD_BYTES);
  warmUps = [];
});

afterEach(async () => {
  await server.stop();
  await rm(scratch, { recursive: true, force: true });
});

describe('ModelManager', () => {
  it('never downloads without a call', async () => {
    serve('alpha');
    const models = manager();

    expect(models.states()).toEqual([
      { id: 'alpha', status: 'not-downloaded', receivedBytes: 0, totalBytes: PAYLOAD_BYTES },
      { id: 'beta', status: 'not-downloaded', receivedBytes: 0, totalBytes: PAYLOAD_BYTES },
    ]);
    await expect(models.verify('alpha')).resolves.toBe('missing');
    await expect(models.verifyActive()).resolves.toBe('missing');
    await expect(models.activeModelPath()).resolves.toBeNull();
    expect(server.requests).toEqual([]);
    await expect(listModels()).resolves.toEqual([]);
  });

  it('downloads, verifies and renames', async () => {
    serve('alpha');
    const models = manager();

    await models.download('alpha');

    await expect(listModels()).resolves.toEqual(['alpha.gguf']);
    expect(Buffer.compare(await readFile(join(modelsDir, 'alpha.gguf')), payload)).toBe(0);
    expect(stateOf(models, 'alpha')).toEqual({ id: 'alpha', status: 'ready', receivedBytes: PAYLOAD_BYTES, totalBytes: PAYLOAD_BYTES });
    await expect(models.verify('alpha')).resolves.toBe('ok');
    expect(server.requests).toEqual([{ path: modelUrlPath('alpha'), range: null }]);
  });

  it('deletes on hash mismatch and reports broken', async () => {
    serve('alpha');
    const models = manager([testEntry('alpha', payload, { sha256: 'f'.repeat(64) })]);

    await expect(models.download('alpha')).rejects.toMatchObject({ name: 'ModelError', reason: 'checksum' });

    await expect(listModels()).resolves.toEqual([]);
    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'broken', receivedBytes: 0 });
  });

  it('resumes a partial download', async () => {
    serve('alpha');
    await mkdir(modelsDir, { recursive: true });
    await writeFile(join(modelsDir, 'alpha.gguf.download'), payload.subarray(0, HALF));
    const models = manager();
    expect(stateOf(models, 'alpha')).toEqual({ id: 'alpha', status: 'paused', receivedBytes: HALF, totalBytes: PAYLOAD_BYTES });

    await models.download('alpha');

    expect(server.requests).toEqual([{ path: modelUrlPath('alpha'), range: `bytes=${HALF}-` }]);
    expect(Buffer.compare(await readFile(join(modelsDir, 'alpha.gguf')), payload)).toBe(0);
    await expect(listModels()).resolves.toEqual(['alpha.gguf']);
    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'ready', receivedBytes: PAYLOAD_BYTES });
  });

  it('deletes a resumed file with a wrong hash', async () => {
    serve('alpha');
    await mkdir(modelsDir, { recursive: true });
    await writeFile(join(modelsDir, 'alpha.gguf.download'), randomBytes(HALF));
    const models = manager();

    await expect(models.download('alpha')).rejects.toMatchObject({ reason: 'checksum' });

    expect(server.requests).toEqual([{ path: modelUrlPath('alpha'), range: `bytes=${HALF}-` }]);
    await expect(listModels()).resolves.toEqual([]);
    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'broken' });
  });

  it('restarts from zero when the server ignores the range', async () => {
    serve('alpha', { ignoreRange: true });
    await mkdir(modelsDir, { recursive: true });
    await writeFile(join(modelsDir, 'alpha.gguf.download'), randomBytes(HALF));
    const models = manager();

    await models.download('alpha');

    expect(server.requests.map((request) => request.range)).toEqual([`bytes=${HALF}-`]);
    expect(Buffer.compare(await readFile(join(modelsDir, 'alpha.gguf')), payload)).toBe(0);
  });

  it('starts over when the partial file is larger than the model', async () => {
    serve('alpha');
    await mkdir(modelsDir, { recursive: true });
    await writeFile(join(modelsDir, 'alpha.gguf.download'), randomBytes(PAYLOAD_BYTES + 10));
    const models = manager();

    await models.download('alpha');

    expect(server.requests.map((request) => request.range)).toEqual([null]);
    expect(Buffer.compare(await readFile(join(modelsDir, 'alpha.gguf')), payload)).toBe(0);
  });

  it('finishes a complete partial file without a request', async () => {
    await mkdir(modelsDir, { recursive: true });
    await writeFile(join(modelsDir, 'alpha.gguf.download'), payload);
    const models = manager();

    await models.download('alpha');

    expect(server.requests).toEqual([]);
    await expect(listModels()).resolves.toEqual(['alpha.gguf']);
    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'ready' });
  });

  it('pause keeps the partial file', async () => {
    serve('alpha', { stallAfterBytes: HALF });
    const models = manager();

    const download = models.download('alpha');
    await vi.waitFor(() => expect(stateOf(models, 'alpha')).toMatchObject({ status: 'downloading', receivedBytes: HALF }));
    models.pause('alpha');
    await download;

    expect(stateOf(models, 'alpha')).toEqual({ id: 'alpha', status: 'paused', receivedBytes: HALF, totalBytes: PAYLOAD_BYTES });
    await expect(listModels()).resolves.toEqual(['alpha.gguf.download']);
    expect((await stat(join(modelsDir, 'alpha.gguf.download'))).size).toBe(HALF);

    serve('alpha');
    await models.download('alpha');

    expect(server.requests.map((request) => request.range)).toEqual([null, `bytes=${HALF}-`]);
    expect(Buffer.compare(await readFile(join(modelsDir, 'alpha.gguf')), payload)).toBe(0);
  });

  it('keeps the partial file when the connection fails', async () => {
    serve('alpha', { stallAfterBytes: HALF });
    const models = manager();

    const download = models.download('alpha');
    await vi.waitFor(() => expect(stateOf(models, 'alpha')).toMatchObject({ receivedBytes: HALF }));
    server.closeConnections();

    await expect(download).rejects.toBeInstanceOf(Error);
    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'paused', receivedBytes: HALF });
    await expect(listModels()).resolves.toEqual(['alpha.gguf.download']);
  });

  it('reports an http failure without leaving files', async () => {
    const models = manager();

    await expect(models.download('alpha')).rejects.toMatchObject({ reason: 'http' });

    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'not-downloaded' });
    await expect(listModels()).resolves.toEqual([]);
  });

  it('runs only one download at a time', async () => {
    serve('alpha', { stallAfterBytes: HALF });
    serve('beta');
    const models = manager();

    const first = models.download('alpha');
    const again = models.download('alpha');
    await expect(models.download('beta')).rejects.toMatchObject({ reason: 'busy' });
    await vi.waitFor(() => expect(stateOf(models, 'alpha')).toMatchObject({ receivedBytes: HALF }));
    models.pause('alpha');
    await Promise.all([first, again]);

    expect(server.requests.map((request) => request.path)).toEqual([modelUrlPath('alpha')]);
    expect(stateOf(models, 'beta')).toMatchObject({ status: 'not-downloaded' });
  });

  it('emits progress at most every 250 ms', async () => {
    serve('alpha', { chunkBytes: 4 * 1024, chunkDelayMs: 15 });
    const models = manager();
    const emitted: Array<{ at: number; alpha: ModelState | undefined }> = [];
    models.onChange((states) => emitted.push({ at: Date.now(), alpha: states.find((state) => state.id === 'alpha') }));

    await models.download('alpha');

    const progress = emitted.filter((entry) => entry.alpha?.status === 'downloading');
    const gaps = progress.slice(1).map((entry, index) => entry.at - (progress[index]?.at ?? 0));
    expect(progress.length).toBeGreaterThan(1);
    expect(gaps.every((gap) => gap >= PROGRESS_INTERVAL_MS - 5)).toBe(true);
    expect(emitted.at(-1)?.alpha?.status).toBe('ready');
  });

  it('stops notifying after unsubscribe', async () => {
    serve('alpha');
    const models = manager();
    const emitted: ModelState[][] = [];
    const unsubscribe = models.onChange((states) => emitted.push(states));
    unsubscribe();

    await models.download('alpha');

    expect(emitted).toEqual([]);
  });

  it('activate requires a ready model and runs warm-up once', async () => {
    serve('alpha');
    const models = manager();

    await expect(models.activate('alpha')).rejects.toMatchObject({ reason: 'not-ready' });
    expect(warmUps).toEqual([]);
    expect(settings.get().localModelId).toBeNull();

    await models.download('alpha');
    await models.activate('alpha');

    const path = join(modelsDir, 'alpha.gguf');
    expect(warmUps).toEqual([path]);
    expect(settings.get().localModelId).toBe('alpha');
    await expect(models.activeModelPath()).resolves.toBe(path);
    await expect(models.verifyActive()).resolves.toBe('ok');
    expect(models.activeLanguageHint()).toBe('ignored');
  });

  it('activates even when the warm-up fails', async () => {
    serve('alpha');
    const logger = new RecordingLogger();
    const models = new ModelManager({
      dir: modelsDir,
      catalog: [testEntry('alpha', payload)],
      settings,
      fetchImpl: server.fetchImpl,
      warmUp: () => Promise.reject(new Error('shader compile failed')),
      logger,
    });
    await models.download('alpha');

    await models.activate('alpha');

    expect(settings.get().localModelId).toBe('alpha');
    expect(logger.errors).toHaveLength(1);
  });

  it('marks a model with a wrong hash as broken on verify', async () => {
    await mkdir(modelsDir, { recursive: true });
    await writeFile(join(modelsDir, 'alpha.gguf'), randomBytes(PAYLOAD_BYTES));
    await settings.update({ localModelId: 'alpha' });
    const models = manager();
    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'ready' });

    await expect(models.verify('alpha')).resolves.toBe('broken');

    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'broken' });
    await expect(models.verifyActive()).resolves.toBe('broken');
    await expect(models.activate('alpha')).rejects.toMatchObject({ reason: 'not-ready' });
    expect(warmUps).toEqual([]);
  });

  it('reports a model of the wrong size as broken at startup', async () => {
    await mkdir(modelsDir, { recursive: true });
    await writeFile(join(modelsDir, 'alpha.gguf'), 'GGUF');

    const models = manager();

    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'broken' });
    await expect(models.verify('alpha')).resolves.toBe('broken');
  });

  it('downloads a broken model again', async () => {
    serve('alpha');
    await mkdir(modelsDir, { recursive: true });
    await writeFile(join(modelsDir, 'alpha.gguf'), randomBytes(PAYLOAD_BYTES));
    const models = manager();
    await models.verify('alpha');

    await models.download('alpha');

    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'ready' });
    await expect(models.verify('alpha')).resolves.toBe('ok');
  });

  it('download of a scanned ready file verifies it instead of trusting the size', async () => {
    serve('alpha');
    serve('beta');
    await mkdir(modelsDir, { recursive: true });
    await writeFile(join(modelsDir, 'alpha.gguf'), payload);
    await writeFile(join(modelsDir, 'beta.gguf'), randomBytes(PAYLOAD_BYTES));
    const models = manager();

    await models.download('alpha');
    await models.download('beta');

    expect(server.requests.map((request) => request.path)).toEqual([modelUrlPath('beta')]);
    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'ready' });
    expect(stateOf(models, 'beta')).toMatchObject({ status: 'ready' });
    await expect(readFile(join(modelsDir, 'beta.gguf'))).resolves.toEqual(payload);
  });

  it('startup verification checks every scanned ready file', async () => {
    await mkdir(modelsDir, { recursive: true });
    await writeFile(join(modelsDir, 'alpha.gguf'), payload);
    await writeFile(join(modelsDir, 'beta.gguf'), randomBytes(PAYLOAD_BYTES));
    await settings.update({ localModelId: 'beta' });
    const models = manager();
    const seen: string[] = [];
    models.onChange((states) => seen.push(states.map((state) => `${state.id}:${state.status}`).join(',')));

    await models.verifyReady();

    expect(seen).toEqual(['alpha:ready,beta:broken']);
    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'ready' });
    expect(stateOf(models, 'beta')).toMatchObject({ status: 'broken' });
    expect(server.requests).toEqual([]);
  });

  it('notices a model removed from disk', async () => {
    serve('alpha');
    const models = manager();
    await models.download('alpha');
    await models.activate('alpha');
    await rm(join(modelsDir, 'alpha.gguf'));

    await expect(models.verifyActive()).resolves.toBe('missing');

    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'not-downloaded', receivedBytes: 0 });
  });

  it('delete of the active model clears localModelId', async () => {
    serve('alpha');
    const models = manager();
    await models.download('alpha');
    await models.activate('alpha');

    await models.delete('alpha');

    await expect(listModels()).resolves.toEqual([]);
    expect(settings.get().localModelId).toBeNull();
    expect(stateOf(models, 'alpha')).toEqual({ id: 'alpha', status: 'not-downloaded', receivedBytes: 0, totalBytes: PAYLOAD_BYTES });
    await expect(models.activeModelPath()).resolves.toBeNull();
  });

  it('delete keeps another active model', async () => {
    serve('alpha');
    serve('beta');
    const models = manager();
    await models.download('alpha');
    await models.download('beta');
    await models.activate('alpha');

    await models.delete('beta');

    expect(settings.get().localModelId).toBe('alpha');
    await expect(listModels()).resolves.toEqual(['alpha.gguf']);
  });

  it('delete during a download stops it and removes the partial file', async () => {
    serve('alpha', { stallAfterBytes: HALF });
    const models = manager();
    const download = models.download('alpha');
    await vi.waitFor(() => expect(stateOf(models, 'alpha')).toMatchObject({ receivedBytes: HALF }));

    await models.delete('alpha');
    await download;

    await expect(listModels()).resolves.toEqual([]);
    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'not-downloaded', receivedBytes: 0 });
  });

  it('treats an unknown active model as no model', async () => {
    await settings.update({ localModelId: 'removed-from-catalog' });
    const models = manager();

    await expect(models.activeModelPath()).resolves.toBeNull();
    await expect(models.verifyActive()).resolves.toBe('missing');
    expect(models.activeLanguageHint()).toBeNull();
  });

  it('rejects unknown model ids', async () => {
    const models = manager();

    await expect(models.download('nope')).rejects.toMatchObject({ reason: 'unknown-model' });
    await expect(models.verify('nope')).rejects.toMatchObject({ reason: 'unknown-model' });
    await expect(models.activate('nope')).rejects.toMatchObject({ reason: 'unknown-model' });
    await expect(models.delete('nope')).rejects.toMatchObject({ reason: 'unknown-model' });
    expect(() => models.pause('nope')).toThrow(expect.objectContaining({ reason: 'unknown-model' }) as Error);
  });
});
