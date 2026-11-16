import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogEntry } from '@codevo-whisper/protocol';
import { FAKE_CATALOG_MODELS } from '../../server/test/support/fake-model-catalog';
import { MODEL_SELECTION_STT, PARAKEET_OPTION, WHISPER_OPTION, type FakeSttBehaviour } from '../../server/test/support/fake-stt-server';
import type { EngineDictation, Preparation } from '../src/main/engines/transcription-engine';
import { serverModelHandlers } from '../src/main/ipc/server-model-handlers';
import { RemoteEngine } from '../src/main/remote/remote-engine';
import { ServerLanguageGate } from '../src/main/remote/server-language-support';
import { serverModelsView, type ServerModelsView } from '../src/renderer/server/server-model-catalog';
import { transcriptionModelPicker, type ModelPicker } from '../src/renderer/server/transcription-model-picker';
import { SettingsStore } from '../src/main/settings/settings-store';
import { grantModelsCommand, type PairedServerView, type ServerStatus } from '../src/shared/server';
import type { ServerModelOutcome } from '../src/shared/server-model-catalog';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { RecordingLogger } from './recording-logger';
import { startTestGateway, type TestGateway } from './support/gateway';
import { createServerService, tinyModels, type ServerServiceHarness } from './support/server-service';

const TURBO = 'whisper-large-v3-turbo';

const TURBO_Q8 = 'whisper-large-v3-turbo-q8';

const TURBO_Q8_ENTRY: CatalogEntry = { id: TURBO_Q8, name: 'Whisper Large v3 Turbo (Q8)', family: 'whisper', sizeBytes: 886_381_728, removable: true, state: 'missing', receivedBytes: null };

const CATALOG_MODELS: readonly CatalogEntry[] = [...FAKE_CATALOG_MODELS, TURBO_Q8_ENTRY];

const OFFERED = [PARAKEET_OPTION, WHISPER_OPTION, { id: TURBO, name: 'Whisper Large v3 Turbo (F16)', available: false, default: false }, { id: TURBO_Q8, name: 'Whisper Large v3 Turbo (Q8)', available: false, default: false }];

const CATALOG_STT: FakeSttBehaviour = {
  capabilities: { status: 200, body: { ...MODEL_SELECTION_STT.body, transcriptionModels: OFFERED } },
  catalog: { downloadsEnabled: true, models: CATALOG_MODELS },
};

const SECOND = 32_000;

let dir: string;
let gateway: TestGateway;
let harness: ServerServiceHarness;

async function start(stt: FakeSttBehaviour = CATALOG_STT): Promise<void> {
  gateway = await startTestGateway({ stt });
  const settings = new SettingsStore(join(dir, 'settings.json'));
  await settings.load();
  const logger = new RecordingLogger();
  harness = createServerService({ dir, settings, models: await tinyModels(dir, settings, logger, false), logger });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-server-downloads-'));
});

afterEach(async () => {
  harness.service.dispose();
  await gateway.close();
  await rm(dir, { recursive: true, force: true });
});

async function pair(): Promise<void> {
  const window = await gateway.openPairingWindow();
  harness.service.pair(window.token);
  await window.admin.next();
  window.admin.send({ decision: 'approve' });
  await window.admin.next();
  window.admin.close();
  await expect.poll(async () => (await harness.service.view()).server?.status.kind).toBe('online');
}

async function server(): Promise<PairedServerView> {
  const paired = (await harness.service.view()).server;
  expect(paired).not.toBeNull();
  return paired as PairedServerView;
}

async function grant(): Promise<void> {
  expect(await gateway.admin({ cmd: 'manage-models', deviceId: (await server()).deviceId, allowed: true })).toEqual({ found: true, manageModels: true });
}

async function pairWithGrant(): Promise<void> {
  await pair();
  await grant();
  await harness.service.refreshModels();
}

async function view(): Promise<ServerModelsView | null> {
  return serverModelsView(await server(), false);
}

async function rows(): Promise<ServerModelsView['rows']> {
  return (await view())?.rows ?? [];
}

async function row(id: string): Promise<ServerModelsView['rows'][number] | undefined> {
  return (await rows()).find((candidate) => candidate.id === id);
}

async function picker(): Promise<ModelPicker | null> {
  return transcriptionModelPicker(await server());
}

function handlers() {
  return serverModelHandlers({ server: harness.service, serverModels: harness.serverModels });
}

function download(id: string): Promise<ServerModelOutcome> {
  return handlers().serverModelDownload(id);
}

function remove(id: string): Promise<ServerModelOutcome> {
  return handlers().serverModelRemove(id);
}

function cancel(id: string): Promise<ServerModelOutcome> {
  return handlers().serverModelCancel(id);
}

function choose(id: string): Promise<void> {
  return harness.service.chooseTranscriptionModel(id);
}

async function dictation(): Promise<EngineDictation> {
  const preparation = await new RemoteEngine({ connector: harness.connector, languages: new ServerLanguageGate(), selection: () => DEFAULT_SETTINGS.languages }).prepare();
  expect(preparation).toMatchObject({ ready: true });
  const { engine } = preparation as Extract<Preparation, { ready: true }>;
  return engine.start({ languages: DEFAULT_SETTINGS.languages, signal: new AbortController().signal });
}

async function dictate(): Promise<string> {
  const running = await dictation();
  running.push(new Uint8Array(SECOND).fill(5));
  return running.finish();
}

function requestedModels(): Array<string | null> {
  return gateway.stt.requests.map((request) => request.model ?? null);
}

function recordStatuses(): ServerStatus['kind'][] {
  const kinds: ServerStatus['kind'][] = [];
  harness.status.onChange((status) => kinds.push(status.kind));
  return kinds;
}

describe('server model downloads', () => {
  it('shows the server catalog to a device without the grant, with the grant command for this device and no buttons', async () => {
    await start();
    await pair();
    const { deviceId } = await server();

    expect((await server()).status).toMatchObject({ kind: 'online', modelCatalog: { canManage: false, downloadsEnabled: true, models: CATALOG_MODELS } });
    expect(await view()).toMatchObject({
      notice: { text: 'Toto zariadenie nemá povolené spravovať modely na serveri. Povoľte ho na serveri príkazom:', command: grantModelsCommand(deviceId) },
      downloading: null,
      busyHint: null,
    });
    expect((await rows()).map((entry) => [entry.name, entry.size, entry.status, entry.action, entry.badge])).toEqual([
      ['Parakeet Ultra (F16)', '1,3 GB', 'Stiahnutý', null, 'Predvolený'],
      ['Whisper Large v3 (F16)', '3,1 GB', 'Stiahnutý', null, null],
      ['Whisper Large v3 Turbo (F16)', '1,6 GB', 'Nie je stiahnutý', null, null],
      ['Whisper Large v3 Turbo (Q8)', '0,9 GB', 'Nie je stiahnutý', null, null],
    ]);
    expect(grantModelsCommand(deviceId)).toBe(`docker compose -f infrastructure/compose/compose.yaml exec gateway codevo-whisper grant-models ${deviceId}`);
    expect(serverModelsView(await server(), true)?.notice?.command).toBe(`codevo-whisper-server grant-models ${deviceId}`);
  });

  it('answers a download without the grant as forbidden and shows the buttons after the grant and a recheck', async () => {
    await start();
    await pair();

    expect(await download(TURBO)).toBe('forbidden');
    expect(gateway.stt.modelOperations()).toEqual([]);

    await grant();
    await handlers().refreshServerModels();

    expect(await view()).toMatchObject({ notice: null });
    expect(await row(TURBO)).toMatchObject({ action: { kind: 'download', label: 'Stiahnuť', disabled: false } });
    expect(await row('whisper-large-v3')).toMatchObject({ action: { kind: 'remove', label: 'Odstrániť', disabled: false } });
    expect(await row('parakeet-ultra')).toMatchObject({ action: null, badge: 'Predvolený' });
  });

  it('downloads a model with progress, allows one download at a time and makes the finished model selectable', async () => {
    await start();
    await pairWithGrant();
    expect((await picker())?.options.find((option) => option.id === TURBO)).toEqual({ id: TURBO, label: 'Whisper Large v3 Turbo (F16) - nie je stiahnutý', disabled: true });

    expect(await download(TURBO)).toBe('started');

    expect(await row(TURBO)).toMatchObject({ status: 'Sťahuje sa, 0 %', percent: 0, action: { kind: 'cancel', label: 'Zrušiť', disabled: false } });
    expect(await row(TURBO_Q8)).toMatchObject({ action: { kind: 'download', disabled: true } });
    expect(await view()).toMatchObject({ downloading: { name: 'Whisper Large v3 Turbo (F16)', percent: 0 }, busyHint: 'Naraz sa sťahuje iba jeden model. Ďalší stiahnete, keď sa tento dokončí.' });
    expect(await download(TURBO_Q8)).toBe('download_busy');

    gateway.stt.completeDownload(TURBO);
    await harness.service.refreshModels();

    expect(await row(TURBO)).toMatchObject({ status: 'Stiahnutý', percent: null, action: { kind: 'remove' } });
    expect(await view()).toMatchObject({ downloading: null, busyHint: null });
    expect((await picker())?.options.find((option) => option.id === TURBO)).toEqual({ id: TURBO, label: 'Whisper Large v3 Turbo (F16)', disabled: false });
    await choose(TURBO);
    expect(await picker()).toMatchObject({ selected: TURBO, description: 'Rýchlejší Whisper, rozpozná jazyk sám.', routesLanguages: false });
    expect(await dictate()).toBe('ahoj svet');
    expect(requestedModels()).toEqual([TURBO]);
    expect(gateway.stt.modelOperations()).toEqual([`POST /download ${TURBO}`, `POST /download ${TURBO_Q8}`]);
  });

  it('cancels a running download and answers a cancel without a download as idle', async () => {
    await start();
    await pairWithGrant();
    await download(TURBO);

    expect(await cancel(TURBO)).toBe('cancelled');

    expect(await row(TURBO)).toMatchObject({ status: 'Nie je stiahnutý', action: { kind: 'download', disabled: false } });
    expect(await view()).toMatchObject({ downloading: null });
    expect(await cancel(TURBO)).toBe('idle');
  });

  it('shows a failed download and starts it again', async () => {
    await start();
    await pairWithGrant();
    await download(TURBO);

    gateway.stt.failDownload(TURBO);
    await harness.service.refreshModels();

    expect(await row(TURBO)).toMatchObject({ status: 'Sťahovanie zlyhalo', failed: true, action: { kind: 'retry', label: 'Skúsiť znova', disabled: false } });
    expect(await download(TURBO)).toBe('started');
    expect(await row(TURBO)).toMatchObject({ status: 'Sťahuje sa, 0 %', failed: false });
  });

  it('removes a model, which then cannot be chosen, and refuses the default and a model in use', async () => {
    await start();
    await pairWithGrant();

    gateway.stt.setModelInUse('whisper-large-v3', true);
    expect(await remove('whisper-large-v3')).toBe('model_in_use');
    expect(await remove('parakeet-ultra')).toBe('model_not_removable');
    gateway.stt.setModelInUse('whisper-large-v3', false);
    expect(await remove('whisper-large-v3')).toBe('removed');

    expect(await row('whisper-large-v3')).toMatchObject({ status: 'Nie je stiahnutý', action: { kind: 'download' } });
    expect((await picker())?.options.find((option) => option.id === 'whisper-large-v3')).toMatchObject({ disabled: true });
    expect(await remove('whisper-large-v3')).toBe('missing');
  });

  it('falls back to the server default when the chosen model is removed', async () => {
    await start();
    await pairWithGrant();
    await choose('whisper-large-v3');

    expect(await remove('whisper-large-v3')).toBe('removed');

    expect(await server()).toMatchObject({ transcriptionModel: 'whisper-large-v3' });
    expect(await picker()).toMatchObject({ selected: 'parakeet-ultra', routesLanguages: true });
    expect(await dictate()).toBe('ahoj svet');
    expect(requestedModels()).toEqual([null]);
  });

  it('shows that downloads are disabled on the server and offers no download or remove', async () => {
    await start({ ...CATALOG_STT, catalog: { downloadsEnabled: false, models: CATALOG_MODELS } });
    await pairWithGrant();

    expect(await view()).toMatchObject({ notice: { text: 'Sťahovanie a odstraňovanie modelov je na serveri vypnuté (STT_MODEL_DOWNLOADS=disabled).', command: null } });
    expect((await rows()).map((entry) => entry.action)).toEqual([null, null, null, null]);
    expect(await download(TURBO)).toBe('downloads_disabled');
  });

  it('never asks a server older than 0.6.0 for the catalog and shows no model section there', async () => {
    await start();
    await pairWithGrant();
    await gateway.restart({ serverVersion: '0.5.0' });
    const asked = gateway.stt.catalogRequests();

    await harness.service.check();

    expect((await server()).status).toMatchObject({ kind: 'online', serverVersion: '0.5.0', modelCatalog: null, transcriptionModels: OFFERED });
    expect(await view()).toBeNull();
    expect(await picker()).toMatchObject({ missingNote: 'Tieto modely na serveri nie sú stiahnuté: Whisper Large v3 Turbo (F16), Whisper Large v3 Turbo (Q8). Spustite na serveri stt-provision.' });
    expect(await download(TURBO)).toBe('unsupported');
    expect(gateway.stt.catalogRequests()).toBe(asked);
    expect(gateway.stt.modelOperations()).toEqual([]);
  });

  it('shows no model section when the server reports an empty catalog of an older stt', async () => {
    await start({ capabilities: MODEL_SELECTION_STT });
    await pairWithGrant();

    expect((await server()).status).toMatchObject({ modelCatalog: { canManage: true, downloadsEnabled: false, models: [] } });
    expect(await view()).toBeNull();
    expect(await download(TURBO)).toBe('stt_unavailable');
  });

  it('answers an operation as unreachable while the server is down', async () => {
    await start();
    await pairWithGrant();
    await gateway.stop();

    expect(await download(TURBO)).toBe('unreachable');
  });

  it('refreshes the catalog without a checking state, shares one connection between overlapping refreshes and leaves a running dictation alone', async () => {
    await start();
    await pairWithGrant();
    await download(TURBO);
    const running = await dictation();
    const asked = gateway.stt.catalogRequests();
    const kinds = recordStatuses();

    await Promise.all([harness.service.refreshModels(), harness.service.refreshModels(), harness.service.refreshModels()]);
    await harness.service.refreshModels();
    running.push(new Uint8Array(SECOND).fill(5));

    expect(await running.finish()).toBe('ahoj svet');
    expect(gateway.stt.catalogRequests()).toBe(asked + 2);
    expect(kinds).toEqual(['online', 'online']);
  });

  it('accepts exactly one catalog model id for each operation and no arguments for a refresh over IPC', async () => {
    await start();
    await pairWithGrant();
    const ipc = handlers();

    for (const operation of [ipc.serverModelDownload, ipc.serverModelRemove, ipc.serverModelCancel]) {
      for (const args of [[], ['Whisper Large'], [TURBO, 'x'], [42], ['a'.repeat(65)], [null], ['../models']]) {
        expect(() => operation(...args)).toThrow('Invalid transcription model');
      }
    }
    await expect(ipc.refreshServerModels('now')).rejects.toThrow('Unexpected arguments');
    expect(gateway.stt.modelOperations()).toEqual([]);
  });
});
