import { afterEach, describe, expect, it } from 'vitest';
import { TranscriptionFailedError, type EngineDictation, type Preparation, type PreparedEngine } from '../src/main/engines/transcription-engine';
import type { ServerPairing } from '../src/main/remote/pairing-repository';
import { RemoteEngine, type RemoteEngineOptions } from '../src/main/remote/remote-engine';
import type { RemoteFailureKind } from '../src/main/remote/remote-failure';
import { ServerConnector, type ConnectionObserver } from '../src/main/remote/server-connector';
import type { ServerOptions } from '../../server/src/app';
import type { FakeSttBehaviour } from '../../server/test/support/fake-stt-server';
import { continuousSpeech, speech } from '../../server/test/support/speech';
import { startTestGateway, type TestGateway } from './support/gateway';

const FRAME = 3200;
const SECOND = 32000;

class RecordingObserver implements ConnectionObserver {
  readonly failures: RemoteFailureKind[] = [];
  connected(): void {}
  failed(kind: RemoteFailureKind): void {
    this.failures.push(kind);
  }
}

let gateway: TestGateway | undefined;

afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
});

function engine(pairing: ServerPairing | null, options: Partial<RemoteEngineOptions> = {}, observer = new RecordingObserver()): RemoteEngine {
  const connector = new ServerConnector({ pairings: { load: () => Promise.resolve(pairing) }, observer, clock: Date.now, timeoutMs: 2000 });
  return new RemoteEngine({ connector, observer, options });
}

async function prepared(remote: RemoteEngine): Promise<PreparedEngine> {
  const preparation = await remote.prepare();
  expect(preparation).toMatchObject({ ready: true });
  return (preparation as Extract<Preparation, { ready: true }>).engine;
}

function speak(dictation: EngineDictation, bytes: number): void {
  for (let offset = 0; offset < bytes; offset += FRAME) {
    dictation.push(new Uint8Array(Math.min(FRAME, bytes - offset)).fill(7));
  }
}

async function talkInRealTime(dictation: EngineDictation, pcm: Uint8Array, clock: { now: number }): Promise<void> {
  for (let offset = 0; offset < pcm.length; offset += 10 * SECOND) {
    talk(dictation, pcm.subarray(offset, offset + 10 * SECOND));
    clock.now += 10_000;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function talk(dictation: EngineDictation, pcm: Uint8Array): void {
  for (let offset = 0; offset < pcm.length; offset += FRAME) {
    dictation.push(pcm.subarray(offset, offset + FRAME));
  }
}

async function startWith(stt: FakeSttBehaviour, server: ServerOptions = {}): Promise<{ gateway: TestGateway; pairing: ServerPairing }> {
  gateway = await startTestGateway({ stt, server });
  return { gateway, pairing: await gateway.addDevice() };
}

const bySize: FakeSttBehaviour = { respond: (pcm) => ({ status: 200, body: { text: `úsek${pcm.length}` } }) };

describe('RemoteEngine', () => {
  it('streams the recording and joins the finals in segment order without repeating the overlap', async () => {
    const { gateway: server, pairing } = await startWith({ respond: (pcm) => ({ status: 200, body: { text: pcm.length === 25 * SECOND ? 'ahoj toto je prvá časť' : 'časť a koniec diktátu' } }) });
    const dictation = (await prepared(engine(pairing))).start({ language: 'sk', signal: new AbortController().signal });

    talk(dictation, continuousSpeech(26));

    expect(await dictation.finish()).toBe('ahoj toto je prvá časť a koniec diktátu');
    expect(server.stt.requests).toEqual([
      { language: 'sk', bytes: 25 * SECOND },
      { language: 'sk', bytes: 2 * SECOND },
    ]);
  });

  it('leaves empty finals out of the text', async () => {
    let calls = 0;
    const { gateway: server, pairing } = await startWith({
      respond: () => {
        calls += 1;
        return { status: 200, body: { text: calls === 1 ? 'prvá veta' : '' } };
      },
    });
    const dictation = (await prepared(engine(pairing))).start({ language: 'cs', signal: new AbortController().signal });

    talk(dictation, speech(26));

    expect(await dictation.finish()).toBe('prvá veta');
    expect(server.stt.requests).toHaveLength(2);
  });

  it('is not ready without a pairing, while the server is down and after a revoke', async () => {
    expect(await engine(null).prepare()).toEqual({ ready: false, reason: 'server-not-paired' });

    const { gateway: server, pairing } = await startWith(bySize);
    await server.admin({ cmd: 'revoke', deviceId: pairing.deviceId });
    const observer = new RecordingObserver();
    expect(await engine(pairing, {}, observer).prepare()).toEqual({ ready: false, reason: 'server-repair-needed' });
    expect(observer.failures).toEqual(['device-unknown']);

    await server.stop();
    expect(await engine(pairing).prepare()).toEqual({ ready: false, reason: 'server-offline' });
  });

  it('maps a busy STT to busy and a broken STT to stt-unavailable', async () => {
    const { gateway: server, pairing } = await startWith({ respond: () => ({ status: 503, body: { error: 'busy' } }) });
    const busy = (await prepared(engine(pairing))).start({ language: 'sk', signal: new AbortController().signal });
    speak(busy, SECOND);
    await expect(busy.finish()).rejects.toEqual(new TranscriptionFailedError('busy'));
    await server.close();

    const broken = await startWith({ respond: () => ({ status: 500, body: { error: 'boom' } }) });
    const failing = (await prepared(engine(broken.pairing))).start({ language: 'sk', signal: new AbortController().signal });
    speak(failing, SECOND);
    await expect(failing.finish()).rejects.toMatchObject({ reason: 'stt-unavailable', textSoFar: '' });
  });

  it('keeps the text recognised before a later segment failed', async () => {
    const { pairing } = await startWith({ respond: (pcm) => (pcm.length === 2 * SECOND ? { status: 500, body: {} } : { status: 200, body: { text: 'toto je začiatok' } }) });
    const dictation = (await prepared(engine(pairing))).start({ language: 'sk', signal: new AbortController().signal });

    talk(dictation, continuousSpeech(26));

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'stt-unavailable', textSoFar: 'toto je začiatok' });
  });

  it('reports a dictation longer than the server allows', async () => {
    const clock = { now: Date.now() };
    const { pairing } = await startWith(bySize, { clock: () => clock.now });
    const dictation = (await prepared(engine(pairing))).start({ language: 'sk', signal: new AbortController().signal });

    await talkInRealTime(dictation, speech(601), clock);

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'too-long' });
  });

  it('cancels a dictation on abort and the gateway aborts its STT call', async () => {
    const { gateway: server, pairing } = await startWith({ delayMs: 2000 });
    const controller = new AbortController();
    const dictation = (await prepared(engine(pairing))).start({ language: 'sk', signal: controller.signal });
    speak(dictation, SECOND);
    const finished = dictation.finish();
    await expect.poll(() => server.stt.requests.length).toBe(1);

    controller.abort();

    await expect(finished).rejects.toMatchObject({ name: 'AbortError' });
    await expect.poll(() => server.stt.aborted()).toBe(1);
  });

  it('gives up when the connected server sends nothing for the finish wait', async () => {
    const { pairing } = await startWith({ delayMs: 5000 });
    const dictation = (await prepared(engine(pairing, { finishIdleMs: 200 }))).start({ language: 'sk', signal: new AbortController().signal });
    speak(dictation, SECOND);

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'stt-unavailable' });
  });

  it('closes the prepared connection when it is released unused', async () => {
    const { gateway: server, pairing } = await startWith(bySize);
    const engineInUse = await prepared(engine(pairing));
    expect(server.server.gateway.sessions.count()).toBe(1);

    engineInUse.release();

    await expect.poll(() => server.server.gateway.sessions.count()).toBe(0);
  });
});
