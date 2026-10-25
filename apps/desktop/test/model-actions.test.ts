import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelActions } from '../src/main/models/model-actions';
import { ModelManager } from '../src/main/models/model-manager';
import { SettingsStore } from '../src/main/settings/settings-store';
import type { ModelState } from '../src/shared/models';
import { FakeHuggingFace } from './fake-hugging-face';
import { modelUrlPath, testEntry } from './model-fixtures';
import { RecordingLogger } from './recording-logger';

const PAYLOAD_BYTES = 128 * 1024;
const HALF = PAYLOAD_BYTES / 2;

let scratch: string;
let modelsDir: string;
let settings: SettingsStore;
let server: FakeHuggingFace;
let payload: Buffer;
let warmUpGate: PromiseWithResolvers<void> | null;
let warmUps: string[];

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-model-actions-'));
  modelsDir = join(scratch, 'models');
  settings = new SettingsStore(join(scratch, 'settings.json'), new RecordingLogger());
  await settings.load();
  server = new FakeHuggingFace();
  await server.start();
  payload = randomBytes(PAYLOAD_BYTES);
  warmUpGate = null;
  warmUps = [];
});

afterEach(async () => {
  await server.stop();
  await rm(scratch, { recursive: true, force: true });
});

function harness() {
  const models = new ModelManager({
    dir: modelsDir,
    catalog: [testEntry('alpha', payload), testEntry('beta', payload)],
    settings,
    fetchImpl: server.fetchImpl,
    warmUp: async (path) => {
      warmUps.push(path);
      await warmUpGate?.promise;
    },
    logger: new RecordingLogger(),
  });
  return { models, actions: new ModelActions({ models, settings }) };
}

function stateOf(models: ModelManager, id: string): ModelState | undefined {
  return models.states().find((state) => state.id === id);
}

async function files(): Promise<string[]> {
  return (await readdir(modelsDir).catch(() => [])).sort();
}

describe('ModelActions', () => {
  it('activates the first downloaded model when none is active', async () => {
    server.serve(modelUrlPath('alpha'), { body: payload });
    server.serve(modelUrlPath('beta'), { body: payload });
    const { models, actions } = harness();

    await actions.download('alpha');
    expect(settings.get().localModelId).toBe('alpha');

    await actions.download('beta');
    expect(settings.get().localModelId).toBe('alpha');
    expect(stateOf(models, 'beta')).toMatchObject({ status: 'ready' });

    await actions.activate('beta');
    expect(settings.get().localModelId).toBe('beta');
  });

  it('delete during a download stops it, removes the partial file and activates nothing', async () => {
    server.serve(modelUrlPath('alpha'), { body: payload, stallAfterBytes: HALF });
    const { models, actions } = harness();

    const download = actions.download('alpha');
    await vi.waitFor(() => expect(stateOf(models, 'alpha')).toMatchObject({ status: 'downloading', receivedBytes: HALF }));
    await actions.delete('alpha');
    await download;

    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'not-downloaded', receivedBytes: 0 });
    await expect(files()).resolves.toEqual([]);
    expect(settings.get().localModelId).toBeNull();
  });

  it('pause keeps the partial file and continue resumes it', async () => {
    server.serve(modelUrlPath('alpha'), { body: payload, stallAfterBytes: HALF });
    const { models, actions } = harness();

    const download = actions.download('alpha');
    await vi.waitFor(() => expect(stateOf(models, 'alpha')).toMatchObject({ receivedBytes: HALF }));
    actions.pause('alpha');
    await download;
    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'paused', receivedBytes: HALF });

    server.serve(modelUrlPath('alpha'), { body: payload });
    await actions.download('alpha');

    expect(stateOf(models, 'alpha')).toMatchObject({ status: 'ready' });
    expect(server.requests.map((request) => request.range)).toEqual([null, `bytes=${HALF}-`]);
  });

  it('delete waits for a running activate of the same model', async () => {
    server.serve(modelUrlPath('alpha'), { body: payload });
    const { actions } = harness();
    await actions.download('alpha');
    await settings.update({ localModelId: null });
    warmUpGate = Promise.withResolvers<void>();

    const activate = actions.activate('alpha');
    await vi.waitFor(() => expect(warmUps).toHaveLength(2));
    const removal = actions.delete('alpha');
    await new Promise((resolve) => setTimeout(resolve, 30));
    await expect(files()).resolves.toEqual(['alpha.gguf']);

    warmUpGate.resolve();
    await activate;
    await removal;

    await expect(files()).resolves.toEqual([]);
    expect(settings.get().localModelId).toBeNull();
  });

  it('activate after delete fails cleanly and keeps no active model', async () => {
    server.serve(modelUrlPath('alpha'), { body: payload });
    const { actions } = harness();
    await actions.download('alpha');

    const removal = actions.delete('alpha');
    const activate = actions.activate('alpha');

    await removal;
    await expect(activate).rejects.toMatchObject({ name: 'ModelError', reason: 'not-ready' });
    expect(settings.get().localModelId).toBeNull();
  });
});
