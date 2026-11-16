import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MODEL_SELECTION_STT, PARAKEET_OPTION, WHISPER_OPTION, type FakeSttResponse } from '../../server/test/support/fake-stt-server';
import type { EngineDictation, Preparation } from '../src/main/engines/transcription-engine';
import { serverHandlers } from '../src/main/ipc/server-handlers';
import { InsecureTestVault } from '../src/main/remote/insecure-test-vault';
import { EncryptedPairingFile } from '../src/main/remote/pairing-repository';
import { RemoteEngine } from '../src/main/remote/remote-engine';
import { ServerLanguageGate } from '../src/main/remote/server-language-support';
import { ServerReconnect } from '../src/main/remote/server-reconnect';
import { failureState } from '../src/main/session/overlay-messages';
import { SettingsStore } from '../src/main/settings/settings-store';
import type { PairedServerView } from '../src/shared/server';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { FakePowerEvents } from './fake-power-events';
import { RecordingLogger } from './recording-logger';
import { startTestGateway, type TestGateway } from './support/gateway';
import { createServerService, tinyModels, type ServerServiceHarness, type ServerServiceSetup } from './support/server-service';

const WHISPER_MISSING: FakeSttResponse = { status: 200, body: { ...MODEL_SELECTION_STT.body, transcriptionModels: [PARAKEET_OPTION, { ...WHISPER_OPTION, available: false }] } };

const SECOND = 32_000;

let dir: string;
let gateway: TestGateway;
let setup: ServerServiceSetup;
let harness: ServerServiceHarness;
let reconnect: ServerReconnect | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-server-models-'));
  gateway = await startTestGateway({ stt: { capabilities: MODEL_SELECTION_STT } });
  const settings = new SettingsStore(join(dir, 'settings.json'));
  await settings.load();
  const logger = new RecordingLogger();
  setup = { dir, settings, models: await tinyModels(dir, settings, logger, false), logger };
  harness = createServerService(setup);
});

afterEach(async () => {
  reconnect?.dispose();
  reconnect = null;
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

async function restartApp(): Promise<void> {
  harness.service.dispose();
  harness = createServerService(setup);
  await harness.service.check();
}

async function server(): Promise<PairedServerView | null> {
  return (await harness.service.view()).server;
}

function choose(id: unknown): Promise<void> {
  return serverHandlers({ server: harness.service }).chooseServerModel(id);
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

describe('server transcription model selection', () => {
  it('shows the offered models without a choice and dictates on the server default without naming a model', async () => {
    await pair();

    expect(await server()).toMatchObject({ transcriptionModel: null, status: { kind: 'online', transcriptionModels: [PARAKEET_OPTION, WHISPER_OPTION] } });
    expect(await dictate()).toBe('ahoj svet');
    expect(requestedModels()).toEqual([null]);
  });

  it('keeps the chosen Whisper with the pairing across a restart and sends it with every dictation', async () => {
    await pair();

    await choose('whisper-large-v3');

    expect(await server()).toMatchObject({ transcriptionModel: 'whisper-large-v3' });
    expect(await new EncryptedPairingFile(harness.file, new InsecureTestVault()).load()).toMatchObject({ transcriptionModel: 'whisper-large-v3' });
    await restartApp();
    expect(await server()).toMatchObject({ transcriptionModel: 'whisper-large-v3', status: { kind: 'online', transcriptionModels: [PARAKEET_OPTION, WHISPER_OPTION] } });
    expect(await dictate()).toBe('ahoj svet');
    expect(requestedModels()).toEqual(['whisper-large-v3']);
    await choose('parakeet-ultra');
    expect(await dictate()).toBe('ahoj svet');
    expect(requestedModels()).toEqual(['whisper-large-v3', 'parakeet-ultra']);
  });

  it('keeps the last of two quickly repeated choices', async () => {
    await pair();
    await choose('parakeet-ultra');

    await Promise.all([choose('whisper-large-v3'), choose('parakeet-ultra')]);

    expect(await server()).toMatchObject({ transcriptionModel: 'parakeet-ultra' });
    expect(await new EncryptedPairingFile(harness.file, new InsecureTestVault()).load()).toMatchObject({ transcriptionModel: 'parakeet-ultra' });
  });

  it('dictates on the default and sends no stale id when the chosen model is no longer available', async () => {
    await pair();
    await choose('whisper-large-v3');
    gateway.stt.setCapabilities(WHISPER_MISSING);

    await harness.service.check();

    expect(await server()).toMatchObject({ transcriptionModel: 'whisper-large-v3', status: { transcriptionModels: [PARAKEET_OPTION, { ...WHISPER_OPTION, available: false }] } });
    expect(await dictate()).toBe('ahoj svet');
    expect(requestedModels()).toEqual([null]);
  });

  it('never sends the choice to a server older than 0.5.0, which would refuse the unknown field', async () => {
    await pair();
    await choose('whisper-large-v3');
    await gateway.restart({ serverVersion: '0.4.0' });

    await harness.service.check();

    expect(await server()).toMatchObject({ transcriptionModel: 'whisper-large-v3', status: { kind: 'online', serverVersion: '0.4.0', transcriptionModels: [] } });
    expect(await dictate()).toBe('ahoj svet');
    expect(requestedModels()).toEqual([null]);
  });

  it('fails a dictation whose model disappeared on the server, points to the server page and refreshes the offered models', async () => {
    await pair();
    reconnect = new ServerReconnect({ status: harness.status, check: () => harness.service.check(), power: new FakePowerEvents(), delaysMs: [40] });
    reconnect.start();
    await choose('whisper-large-v3');
    const running = await dictation();
    gateway.stt.setCapabilities(WHISPER_MISSING);

    running.push(new Uint8Array(SECOND).fill(5));

    await expect(running.finish()).rejects.toMatchObject({ reason: 'model-unavailable' });
    expect(failureState('model-unavailable', false)).toEqual({ kind: 'error', message: 'Zvolený model na serveri nie je dostupný. Vyberte iný na stránke Prepis.', action: 'open-server' });
    await expect.poll(async () => (await server())?.status).toMatchObject({ kind: 'online', transcriptionModels: [PARAKEET_OPTION, { ...WHISPER_OPTION, available: false }] });
    expect(await dictate()).toBe('ahoj svet');
    expect(requestedModels()).toEqual([null]);
  });

  it('forgets the choice when the server is unpaired and paired again', async () => {
    await pair();
    await choose('whisper-large-v3');

    await harness.service.disconnect();
    await choose('parakeet-ultra');
    expect(await server()).toBeNull();
    await pair();

    expect(await server()).toMatchObject({ transcriptionModel: null });
  });

  it('accepts exactly one transcription model id over IPC', async () => {
    await pair();
    const handlers = serverHandlers({ server: harness.service });

    for (const args of [[], ['Whisper Large'], ['whisper-large-v3', 'x'], [42], ['a'.repeat(65)], [null]]) {
      expect(() => handlers.chooseServerModel(...args)).toThrow('Invalid transcription model');
    }
    expect(await server()).toMatchObject({ transcriptionModel: null });
  });
});
