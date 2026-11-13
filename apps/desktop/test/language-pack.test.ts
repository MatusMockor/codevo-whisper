import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { modelHandlers } from '../src/main/ipc/model-handlers';
import { IpcValidationError } from '../src/main/ipc/validate';
import { createLanguagePack, languagePackMemory, type LanguagePack } from '../src/main/models/language-pack';
import { loadCatalog } from '../src/main/models/model-catalog';
import { ModelActions } from '../src/main/models/model-actions';
import { ModelManager } from '../src/main/models/model-manager';
import { SettingsStore } from '../src/main/settings/settings-store';
import { isLanguagePackReady, type LanguagePackView } from '../src/shared/models';
import { FakeHuggingFace } from './fake-hugging-face';
import { modelUrlPath, testEntry } from './model-fixtures';
import { RecordingLogger } from './recording-logger';

const BUNDLED = fileURLToPath(new URL('../resources/model-catalog.json', import.meta.url));
const GIB = 1024 ** 3;
const canaryBody = randomBytes(96 * 1024);
const languageIdBody = randomBytes(16 * 1024);
const PARAKEET = testEntry('parakeet', 'GGUF-parakeet', { minRamBytes: 2 * GIB });
const CANARY = testEntry('canary', canaryBody, { languageHint: 'required', minRamBytes: 2 * GIB });
const LANGUAGE_ID = testEntry('langid', languageIdBody, { minRamBytes: GIB / 4 });

let scratch: string;
let settings: SettingsStore;
let server: FakeHuggingFace;
let models: ModelManager;

function pack(totalMemory = 16 * GIB): LanguagePack {
  return createLanguagePack({
    dir: join(scratch, 'models'),
    conditioned: CANARY,
    languageId: LANGUAGE_ID,
    models,
    requiredRamBytes: languagePackMemory([PARAKEET, CANARY], CANARY, LANGUAGE_ID),
    totalMemory: () => totalMemory,
    settings,
    logger: new RecordingLogger(),
    fetchImpl: server.fetchImpl,
  });
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-language-pack-'));
  settings = new SettingsStore(join(scratch, 'settings.json'));
  await settings.load();
  await settings.update({ localModelId: 'parakeet' });
  server = new FakeHuggingFace();
  await server.start();
  server.serve(modelUrlPath('canary'), { body: canaryBody, chunkBytes: 8 * 1024 });
  server.serve(modelUrlPath('langid'), { body: languageIdBody });
  models = new ModelManager({ dir: join(scratch, 'models'), catalog: [PARAKEET, CANARY], settings, warmUp: () => Promise.resolve(), fetchImpl: server.fetchImpl });
});

afterEach(async () => {
  await server.stop();
  await rm(scratch, { recursive: true, force: true });
});

describe('language pack', () => {
  it('downloads canary and language ID with progress, keeps the active model and only then hands out both paths', async () => {
    const languagePack = pack();
    const views: LanguagePackView[] = [];
    languagePack.onChange((view) => views.push(view));

    expect(languagePack.view()).toMatchObject({ conditioned: { model: { id: 'canary' }, state: { status: 'not-downloaded' } }, languageId: { model: { id: 'langid' }, state: { status: 'not-downloaded' } }, enoughMemory: true });
    await expect(languagePack.paths()).resolves.toBeNull();

    await languagePack.download();

    expect(isLanguagePackReady(languagePack.view())).toBe(true);
    expect(views.some((view) => view.conditioned.state.status === 'downloading')).toBe(true);
    expect(views.some((view) => view.languageId.state.status === 'downloading')).toBe(true);
    expect(isLanguagePackReady(views.at(-1) ?? languagePack.view())).toBe(true);
    await expect(languagePack.paths()).resolves.toEqual({ conditioned: join(scratch, 'models', 'canary.gguf'), languageId: join(scratch, 'models', 'langid.gguf') });
    expect(settings.get().localModelId).toBe('parakeet');
    expect(server.requests.map((request) => request.path)).toEqual([modelUrlPath('langid'), modelUrlPath('canary')]);
  });

  it('skips a part that is already downloaded', async () => {
    await mkdir(join(scratch, 'models'), { recursive: true });
    await writeFile(join(scratch, 'models', 'canary.gguf'), canaryBody);
    models = new ModelManager({ dir: join(scratch, 'models'), catalog: [PARAKEET, CANARY], settings, warmUp: () => Promise.resolve(), fetchImpl: server.fetchImpl });
    const languagePack = pack();

    await languagePack.download();

    expect(server.requests.map((request) => request.path)).toEqual([modelUrlPath('langid')]);
    expect(isLanguagePackReady(languagePack.view())).toBe(true);
  });

  it('withholds the paths while a part fails verification', async () => {
    await mkdir(join(scratch, 'models'), { recursive: true });
    await writeFile(join(scratch, 'models', 'canary.gguf'), canaryBody);
    await writeFile(join(scratch, 'models', 'langid.gguf'), randomBytes(languageIdBody.byteLength));

    await expect(pack().paths()).resolves.toBeNull();
  });

  it('is not offered and refuses to download on a computer with too little memory', async () => {
    const languagePack = pack(4 * GIB);

    expect(languagePack.view()).toMatchObject({ requiredRamBytes: 4.25 * GIB, enoughMemory: false });
    await expect(languagePack.download()).rejects.toThrow('memory');
    expect(server.requests).toEqual([]);
  });

  it('sizes the memory need from both pack models and the largest verbatim companion of the bundled catalog', () => {
    const catalog = loadCatalog(BUNDLED);
    const canary = catalog.conditionedModel();

    expect(canary.id).toBe('canary-1b-v2-q8');
    expect(languagePackMemory(catalog.models, canary, catalog.languageId)).toBe(4 * GIB + 256 * 1024 ** 2);
  });

  it('is reachable over IPC only without arguments', async () => {
    const languagePack = pack();
    const handlers = modelHandlers({ catalog: { models: [], defaultModelId: 'parakeet' }, models, actions: new ModelActions({ models, settings }), languagePack, pickModelFile: () => Promise.resolve(null) });

    await expect(handlers.downloadLanguagePack('canary')).rejects.toThrow(IpcValidationError);
    expect(server.requests).toEqual([]);
    await expect(handlers.getLanguagePack()).resolves.toMatchObject({ conditioned: { state: { status: 'not-downloaded' } } });
    await handlers.downloadLanguagePack();
    expect(isLanguagePackReady(await handlers.getLanguagePack())).toBe(true);
  });

  it('uses a picked model file over IPC and treats a cancelled dialog as no choice', async () => {
    const picked = join(scratch, 'picked.gguf');
    await writeFile(picked, canaryBody);
    let choice: string | null = null;
    const handlers = modelHandlers({ catalog: { models: [], defaultModelId: 'parakeet' }, models, actions: new ModelActions({ models, settings }), languagePack: pack(), pickModelFile: () => Promise.resolve(choice) });

    await expect(handlers.useExistingModel()).resolves.toBeNull();
    await expect(handlers.useExistingModel(picked)).rejects.toThrow(IpcValidationError);
    choice = picked;
    await expect(handlers.useExistingModel()).resolves.toBe('canary');
    await expect(models.verify('canary')).resolves.toBe('ok');
    expect(server.requests).toEqual([]);
  });
});
