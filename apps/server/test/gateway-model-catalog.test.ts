import { PassThrough } from 'node:stream';
import type { ClientMessage, ModelOperation, ServerMessage } from '@codevo-whisper/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli/commands';
import { FAKE_CATALOG_MODELS } from './support/fake-model-catalog';
import { MODEL_SELECTION_STT, PARAKEET_OPTION, startFakeSttServer, WHISPER_OPTION, type FakeSttBehaviour, type FakeSttServer } from './support/fake-stt-server';
import { sendAudio } from './support/send-audio';
import { startHarness, type Harness } from './support/server-harness';
import { speech } from './support/speech';
import { createTempDir } from './support/temp-dir';
import { connectSession, type TestSession } from './support/test-client';

const TURBO_OPTION = { id: 'whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo (F16)', available: false, default: false };

const CATALOG_STT = { status: 200, body: { ...MODEL_SELECTION_STT.body, transcriptionModels: [PARAKEET_OPTION, WHISPER_OPTION, TURBO_OPTION] } };

const MODEL_STT: FakeSttBehaviour = { capabilities: CATALOG_STT, catalog: { downloadsEnabled: true, models: FAKE_CATALOG_MODELS } };

type CatalogReply = Extract<ServerMessage, { type: 'capabilities' }>;

let dir: Awaited<ReturnType<typeof createTempDir>>;
let fake: FakeSttServer;
let harness: Harness | undefined;

beforeEach(async () => {
  dir = await createTempDir();
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await fake.close();
  await dir.remove();
});

async function start(behaviour: FakeSttBehaviour = MODEL_STT): Promise<Harness> {
  fake = await startFakeSttServer(behaviour);
  harness = await startHarness(dir.path, fake.url);
  return harness;
}

async function readySession(server: Harness): Promise<{ session: TestSession; deviceId: string }> {
  const device = await server.addDevice();
  const session = await connectSession(server.url, device, server.serverKey.publicKey);
  expect(await session.next()).toMatchObject({ type: 'ready' });
  const registered = await server.devices.findByPublicKey(device.publicKey);
  return { session, deviceId: registered?.id ?? '' };
}

async function cli(server: Harness, args: string[]): Promise<{ exit: number; output: string }> {
  const output = new PassThrough();
  let written = '';
  output.on('data', (chunk: Buffer) => {
    written += chunk.toString('utf8');
  });
  const exit = await runCli(args, { input: new PassThrough(), output, socketPath: server.config.adminSocket });
  return { exit, output: written };
}

async function catalogOf(session: TestSession, request: Partial<Extract<ClientMessage, { type: 'capabilities' }>> = {}): Promise<CatalogReply> {
  session.send({ type: 'capabilities', modelCatalog: true, ...request });
  const reply = await session.next();
  expect(reply.type).toBe('capabilities');
  return reply as CatalogReply;
}

async function operate(session: TestSession, operation: ModelOperation, id: string): Promise<ServerMessage> {
  const type = ({ download: 'model-download', remove: 'model-remove', cancel: 'model-download-cancel' } as const)[operation];
  session.send({ type, id });
  return session.next();
}

async function refusedStart(session: TestSession, model: string): Promise<ServerMessage> {
  session.send({ type: 'start', sessionId: 's1', language: 'sk', model });
  return session.next();
}

function entryState(reply: CatalogReply, id: string): string | undefined {
  return reply.modelCatalog?.models.find((model) => model.id === id)?.state;
}

async function dictate(session: TestSession, model: string): Promise<ServerMessage[]> {
  session.send({ type: 'start', sessionId: 's1', language: 'sk', model });
  sendAudio(session, speech(2));
  session.send({ type: 'finish' });
  const messages: ServerMessage[] = [];
  for (;;) {
    const message = await session.next();
    messages.push(message);
    if (message.type === 'done' || message.type === 'error') {
      return messages;
    }
  }
}

describe('model catalog on the gateway', () => {
  it('answers a capabilities request without the catalog flag exactly as before and never asks the stt for the catalog', async () => {
    const { session } = await readySession(await start());

    session.send({ type: 'capabilities', transcriptionModels: true });
    expect(await session.next()).toStrictEqual({
      type: 'capabilities',
      languages: CATALOG_STT.body.languages,
      models: CATALOG_STT.body.models,
      transcriptionModels: [PARAKEET_OPTION, WHISPER_OPTION, TURBO_OPTION],
    });
    session.send({ type: 'capabilities', modelCatalog: false });
    expect(await session.next()).toStrictEqual({ type: 'capabilities', languages: CATALOG_STT.body.languages, models: CATALOG_STT.body.models });
    expect(fake.catalogRequests()).toBe(0);
  });

  it('adds the catalog for a client that asks for it and tells a device without the grant that it cannot manage models', async () => {
    const { session } = await readySession(await start());

    expect(await catalogOf(session)).toStrictEqual({
      type: 'capabilities',
      languages: CATALOG_STT.body.languages,
      models: CATALOG_STT.body.models,
      modelCatalog: { canManage: false, downloadsEnabled: true, models: FAKE_CATALOG_MODELS },
    });
    expect(await catalogOf(session, { transcriptionModels: true })).toMatchObject({ transcriptionModels: [PARAKEET_OPTION, WHISPER_OPTION, TURBO_OPTION], modelCatalog: { canManage: false } });
  });

  it('refuses every model operation of a device without the grant and never reaches the stt', async () => {
    const { session } = await readySession(await start());

    for (const operation of ['download', 'remove', 'cancel'] as const) {
      expect(await operate(session, operation, 'whisper-large-v3-turbo')).toEqual({ type: 'model-operation', id: 'whisper-large-v3-turbo', operation, outcome: 'forbidden' });
    }
    expect(fake.modelOperations()).toEqual([]);
  });

  it('lets a device granted by the admin CLI download a model, follow its progress and dictate with it, without reconnecting', async () => {
    const server = await start();
    const { session, deviceId } = await readySession(server);
    expect(await operate(session, 'download', 'whisper-large-v3-turbo')).toMatchObject({ outcome: 'forbidden' });

    expect(await cli(server, ['grant-models', deviceId])).toMatchObject({ exit: 0 });

    expect((await catalogOf(session)).modelCatalog?.canManage).toBe(true);
    expect(await operate(session, 'download', 'whisper-large-v3-turbo')).toEqual({ type: 'model-operation', id: 'whisper-large-v3-turbo', operation: 'download', outcome: 'started' });
    const downloading = await catalogOf(session);
    expect(downloading.modelCatalog?.models.find((model) => model.id === 'whisper-large-v3-turbo')).toMatchObject({ state: 'downloading', receivedBytes: 0 });
    expect(await refusedStart(session, 'whisper-large-v3-turbo')).toEqual({ type: 'error', code: 'model_unavailable', message: 'model_unavailable', sessionId: 's1' });

    fake.completeDownload('whisper-large-v3-turbo');
    const installed = await catalogOf(session, { transcriptionModels: true });

    expect(entryState(installed, 'whisper-large-v3-turbo')).toBe('installed');
    expect(installed.transcriptionModels).toContainEqual({ ...TURBO_OPTION, available: true });
    expect(await dictate(session, 'whisper-large-v3-turbo')).toEqual([
      { type: 'final', sessionId: 's1', segmentId: 0, text: 'ahoj svet' },
      { type: 'done', sessionId: 's1' },
    ]);
    expect(fake.modelOperations()).toEqual(['POST /download whisper-large-v3-turbo']);
  });

  it('removes a model, which then becomes unavailable for new dictations', async () => {
    const server = await start();
    const { session, deviceId } = await readySession(server);
    await server.devices.allowModelManagement(deviceId, true);

    expect(await operate(session, 'remove', 'whisper-large-v3')).toEqual({ type: 'model-operation', id: 'whisper-large-v3', operation: 'remove', outcome: 'removed' });

    expect(await refusedStart(session, 'whisper-large-v3')).toEqual({ type: 'error', code: 'model_unavailable', message: 'model_unavailable', sessionId: 's1' });
    expect(entryState(await catalogOf(session), 'whisper-large-v3')).toBe('missing');
    expect(await operate(session, 'remove', 'whisper-large-v3')).toMatchObject({ outcome: 'missing' });
  });

  it('passes the refusals of the stt on to the device', async () => {
    const server = await start();
    const { session, deviceId } = await readySession(server);
    await server.devices.allowModelManagement(deviceId, true);
    fake.setModelInUse('whisper-large-v3', true);

    expect(await operate(session, 'remove', 'parakeet-ultra')).toMatchObject({ outcome: 'model_not_removable' });
    expect(await operate(session, 'remove', 'whisper-large-v3')).toMatchObject({ outcome: 'model_in_use' });
    expect(await operate(session, 'download', 'canary-1b-v2')).toMatchObject({ outcome: 'unknown_model' });
    expect(await operate(session, 'download', 'whisper-large-v3')).toMatchObject({ outcome: 'installed' });
    expect(await operate(session, 'cancel', 'whisper-large-v3-turbo')).toMatchObject({ outcome: 'idle' });
    expect(await operate(session, 'download', 'whisper-large-v3-turbo')).toMatchObject({ outcome: 'started' });
    expect(await operate(session, 'remove', 'whisper-large-v3-turbo')).toMatchObject({ outcome: 'download_busy' });
    expect(await operate(session, 'cancel', 'whisper-large-v3-turbo')).toMatchObject({ outcome: 'cancelled' });
    expect(entryState(await catalogOf(session), 'whisper-large-v3-turbo')).toBe('missing');
  });

  it('reports the kill switch of the stt', async () => {
    const server = await start({ capabilities: CATALOG_STT, catalog: { downloadsEnabled: false, models: FAKE_CATALOG_MODELS } });
    const { session, deviceId } = await readySession(server);
    await server.devices.allowModelManagement(deviceId, true);

    expect((await catalogOf(session)).modelCatalog).toMatchObject({ canManage: true, downloadsEnabled: false });
    expect(await operate(session, 'download', 'whisper-large-v3-turbo')).toMatchObject({ outcome: 'downloads_disabled' });
    expect(await operate(session, 'remove', 'whisper-large-v3')).toMatchObject({ outcome: 'downloads_disabled' });
  });

  it('reports an empty catalog and stt_unavailable when the stt predates model downloads', async () => {
    const server = await start({ capabilities: CATALOG_STT });
    const { session, deviceId } = await readySession(server);
    await server.devices.allowModelManagement(deviceId, true);

    expect((await catalogOf(session)).modelCatalog).toEqual({ canManage: true, downloadsEnabled: false, models: [] });
    expect(await operate(session, 'download', 'whisper-large-v3-turbo')).toMatchObject({ outcome: 'stt_unavailable' });
  });

  it('stops granting after revoke-models', async () => {
    const server = await start();
    const { session, deviceId } = await readySession(server);
    await server.devices.allowModelManagement(deviceId, true);

    expect(await cli(server, ['revoke-models', deviceId])).toMatchObject({ exit: 0 });

    expect((await catalogOf(session)).modelCatalog?.canManage).toBe(false);
    expect(await operate(session, 'download', 'whisper-large-v3-turbo')).toMatchObject({ outcome: 'forbidden' });
  });

  it('accepts model operations only while the session is idle', async () => {
    const server = await start();
    const { session, deviceId } = await readySession(server);
    await server.devices.allowModelManagement(deviceId, true);
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });

    session.send({ type: 'model-download', id: 'whisper-large-v3-turbo' });

    expect(await session.next()).toEqual({ type: 'error', code: 'bad_message', message: 'bad_message' });
    expect((await session.closed).code).toBe(4000);
    expect(fake.modelOperations()).toEqual([]);
  });
});
