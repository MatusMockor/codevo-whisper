import { afterEach, describe, expect, it } from 'vitest';
import type { EngineDictation, Preparation } from '../src/main/engines/transcription-engine';
import type { ServerPairing } from '../src/main/remote/pairing-repository';
import { RemoteEngine, type RemoteEngineOptions } from '../src/main/remote/remote-engine';
import { ServerConnector } from '../src/main/remote/server-connector';
import type { FakeSttBehaviour } from '../../server/test/support/fake-stt-server';
import { startDropProxy, type DropProxy } from './support/drop-proxy';
import { freePort, startTestGateway, type TestGateway } from './support/gateway';

const FRAME = 3200;
const SECOND = 32000;
const silentObserver = { connected: () => undefined, failed: () => undefined };
const bySize: FakeSttBehaviour = { respond: (pcm) => ({ status: 200, body: { text: `úsek${pcm.length}` } }) };

let gateway: TestGateway | undefined;
let proxy: DropProxy | undefined;

afterEach(async () => {
  await proxy?.close();
  proxy = undefined;
  await gateway?.close();
  gateway = undefined;
});

type Setup = { server: TestGateway; relay: DropProxy; dictation: EngineDictation; source: PairingSource; controller: AbortController };

type SetupOptions = { keepAliveMs?: number; timeoutMs?: number };

type PairingSource = { current: ServerPairing | null; gate: Promise<void> };

async function setup(stt: FakeSttBehaviour, options: Partial<RemoteEngineOptions> = {}, keepAliveMs?: number, extra: SetupOptions = {}): Promise<Setup> {
  const proxyPort = await freePort();
  gateway = await startTestGateway({ stt, publicEndpoint: () => `ws://127.0.0.1:${proxyPort}` });
  proxy = await startDropProxy(gateway.port, proxyPort);
  const source: PairingSource = { current: await gateway.addDevice(), gate: Promise.resolve() };
  const pairings = { load: () => source.gate.then(() => source.current) };
  const connector = new ServerConnector({ pairings, observer: silentObserver, clock: Date.now, timeoutMs: extra.timeoutMs ?? 2000, ...(keepAliveMs === undefined ? {} : { keepAliveMs }) });
  const preparation = await new RemoteEngine({ connector, observer: silentObserver, options }).prepare();
  expect(preparation).toMatchObject({ ready: true });
  const controller = new AbortController();
  const dictation = (preparation as Extract<Preparation, { ready: true }>).engine.start({ language: 'sk', signal: controller.signal });
  return { server: gateway, relay: proxy, dictation, source, controller };
}

function speak(dictation: EngineDictation, bytes: number): void {
  for (let offset = 0; offset < bytes; offset += FRAME) {
    dictation.push(new Uint8Array(FRAME).fill(5));
  }
}

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('RemoteDictation retry', () => {
  it('reconnects once when the connection drops while recording and sends the whole audio again', async () => {
    const { server, relay, dictation } = await setup(bySize);
    speak(dictation, SECOND);
    await settle(50);

    relay.dropAll();
    await settle(50);
    speak(dictation, SECOND);

    expect(await dictation.finish()).toBe('úsek64000');
    expect(relay.connections()).toBe(2);
    expect(server.stt.requests).toEqual([{ language: 'sk', bytes: 64000 }]);
  });

  it('retries a dictation that dropped while the server was transcribing, without duplicating text', async () => {
    const { server, relay, dictation } = await setup({ ...bySize, delayMs: 300 });
    speak(dictation, SECOND);
    const finished = dictation.finish();
    await expect.poll(() => server.stt.requests.length).toBe(1);

    relay.dropAll();

    expect(await finished).toBe('úsek32000');
    expect(relay.connections()).toBe(2);
  });

  it('gives up after the second drop and keeps the best text so far', async () => {
    const { server, relay, dictation } = await setup({ ...bySize, delayMs: 200 });
    speak(dictation, 26 * SECOND);
    const finished = dictation.finish();
    await expect.poll(() => server.stt.requests.length).toBe(2);
    await settle(50);
    relay.dropAll();
    await expect.poll(() => server.stt.requests.length).toBe(3);

    relay.dropAll();

    await expect(finished).rejects.toMatchObject({ reason: 'connection-lost', textSoFar: 'úsek800000' });
    expect(relay.connections()).toBe(2);
  });

  it('does not retry once the recording outgrew the retry buffer', async () => {
    const { relay, dictation } = await setup(bySize, { retryBufferBytes: 2 * SECOND });
    speak(dictation, 3 * SECOND);
    await settle(50);

    relay.dropAll();

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'connection-lost' });
    expect(relay.connections()).toBe(1);
  });

  it('never retries a revoked device', async () => {
    const { server, relay, dictation } = await setup(bySize);
    speak(dictation, SECOND);
    const pairingId = (await server.admin({ cmd: 'devices' })) as { devices: Array<{ id: string }> };

    await server.admin({ cmd: 'revoke', deviceId: pairingId.devices[0]?.id });

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'repair-needed' });
    expect(relay.connections()).toBe(1);
  });

  it('fails instead of replaying a truncated recording when the buffer overflows during the reconnect', async () => {
    const { server, relay, dictation, source } = await setup(bySize, { retryBufferBytes: 2 * SECOND });
    speak(dictation, SECOND);
    await settle(50);
    const reconnect = Promise.withResolvers<void>();
    source.gate = reconnect.promise;

    relay.dropAll();
    await settle(50);
    speak(dictation, 2 * SECOND);
    reconnect.resolve();

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'connection-lost' });
    expect(server.stt.requests).toEqual([]);
  });

  it('does not replay the recording to a different server after the pairing changed', async () => {
    const { relay, dictation, source } = await setup(bySize);
    const other = await startTestGateway({ stt: bySize });
    speak(dictation, SECOND);
    await settle(50);
    source.current = await other.addDevice();

    relay.dropAll();

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'connection-lost' });
    expect(other.stt.requests).toEqual([]);
    expect(other.server.gateway.sessions.count()).toBe(0);
    await other.close();
  });

  it('keeps waiting for a slow but connected server after finish and never retries it', async () => {
    const { server, relay, dictation } = await setup({ ...bySize, delayMs: 2000 }, { finishIdleMs: 300 });
    speak(dictation, SECOND);

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'stt-unavailable' });
    expect(relay.connections()).toBe(1);
    expect(server.stt.requests).toHaveLength(1);
  });

  it('retries after finish when the connection silently stops answering', async () => {
    const { server, relay, dictation } = await setup({ ...bySize, delayMs: 300 }, {}, 100);
    speak(dictation, SECOND);
    const finished = dictation.finish();
    await expect.poll(() => server.stt.requests.length).toBe(1);

    relay.freezeAll();

    expect(await finished).toBe('úsek32000');
    expect(relay.connections()).toBe(2);
  });

  it('waits for a restarting gateway when it reconnects', async () => {
    const { server, relay, dictation } = await setup({ ...bySize, delayMs: 300 });
    speak(dictation, SECOND);
    const finished = dictation.finish();
    await expect.poll(() => server.stt.requests.length).toBe(1);

    await server.restart();

    expect(await finished).toBe('úsek32000');
    expect(relay.connections()).toBeGreaterThanOrEqual(2);
  });

  it('stops reconnecting when the dictation is cancelled during the backoff and opens no further connection', async () => {
    const { server, relay, dictation, controller } = await setup({ ...bySize, delayMs: 2000 }, { reconnectDelaysMs: [400, 400, 400] });
    speak(dictation, SECOND);
    const finished = dictation.finish();
    await settle(50);
    await server.stop();
    await expect.poll(() => relay.connections()).toBe(2);
    await settle(100);

    controller.abort();

    await expect(finished).rejects.toMatchObject({ name: 'AbortError' });
    await settle(1000);
    expect(relay.connections()).toBe(2);
  });

  it('stops after one reconnect attempt when the server no longer knows the device', async () => {
    const { server, relay, dictation, source } = await setup(bySize, { reconnectDelaysMs: [50, 50, 50] });
    speak(dictation, SECOND);
    await settle(50);
    const opened = Promise.withResolvers<void>();
    source.gate = opened.promise;
    relay.dropAll();
    const devices = (await server.admin({ cmd: 'devices' })) as { devices: Array<{ id: string }> };
    await server.admin({ cmd: 'revoke', deviceId: devices.devices[0]?.id });

    opened.resolve();

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'repair-needed' });
    expect(relay.connections()).toBe(2);
  });

  it('stops after one reconnect attempt when the server key changed', async () => {
    const { server, relay, dictation, source } = await setup(bySize, { reconnectDelaysMs: [50, 50, 50] });
    speak(dictation, SECOND);
    await settle(50);
    const opened = Promise.withResolvers<void>();
    source.gate = opened.promise;
    relay.dropAll();
    await server.admin({ cmd: 'rotate-key' });

    opened.resolve();

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'repair-needed' });
    expect(relay.connections()).toBe(2);
  });

  it('gives up reconnecting to a server that keeps refusing once the overall deadline passes', async () => {
    const { server, relay, dictation } = await setup({ ...bySize, delayMs: 2000 }, { reconnectDelaysMs: Array.from({ length: 50 }, () => 50), reconnectWindowMs: 600 });
    speak(dictation, SECOND);
    const finished = dictation.finish();
    await settle(50);
    const startedAt = Date.now();

    await server.stop();

    await expect(finished).rejects.toMatchObject({ reason: 'connection-lost' });
    expect(Date.now() - startedAt).toBeLessThan(1500);
    expect(relay.connections()).toBeGreaterThan(2);
  });

  it('does not back off again after a reconnect attempt timed out on silently dropped packets', async () => {
    const { relay, dictation } = await setup(bySize, { reconnectDelaysMs: [50, 50, 50], reconnectWindowMs: 5000 }, undefined, { timeoutMs: 300 });
    speak(dictation, SECOND);
    await settle(50);
    relay.blackhole();
    const startedAt = Date.now();

    relay.dropAll();

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'connection-lost' });
    expect(Date.now() - startedAt).toBeLessThan(1500);
    expect(relay.connections()).toBe(2);
  });

  it('caps a slow reconnect attempt at the overall deadline', async () => {
    const { relay, dictation } = await setup(bySize, { reconnectWindowMs: 300 }, undefined, { timeoutMs: 5000 });
    speak(dictation, SECOND);
    await settle(50);
    relay.blackhole();
    const startedAt = Date.now();

    relay.dropAll();

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'connection-lost' });
    expect(Date.now() - startedAt).toBeLessThan(1500);
  });
});
