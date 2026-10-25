import { afterEach, describe, expect, it } from 'vitest';
import type { EngineDictation, Preparation } from '../src/main/engines/transcription-engine';
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

async function setup(stt: FakeSttBehaviour, options: Partial<RemoteEngineOptions> = {}): Promise<{ server: TestGateway; relay: DropProxy; dictation: EngineDictation }> {
  const proxyPort = await freePort();
  gateway = await startTestGateway({ stt, publicEndpoint: () => `ws://127.0.0.1:${proxyPort}` });
  proxy = await startDropProxy(gateway.port, proxyPort);
  const pairing = await gateway.addDevice();
  const connector = new ServerConnector({ pairings: { load: () => Promise.resolve(pairing) }, observer: silentObserver, clock: Date.now, timeoutMs: 2000 });
  const preparation = await new RemoteEngine({ connector, observer: silentObserver, options }).prepare();
  expect(preparation).toMatchObject({ ready: true });
  const dictation = (preparation as Extract<Preparation, { ready: true }>).engine.start({ language: 'sk', signal: new AbortController().signal });
  return { server: gateway, relay: proxy, dictation };
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
});
