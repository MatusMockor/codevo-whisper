import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineUnavailableError, TranscriptionFailedError, type EngineDictation, type Preparation, type PreparedEngine } from '../src/main/engines/transcription-engine';
import { InsecureTestVault } from '../src/main/remote/insecure-test-vault';
import { EncryptedPairingFile, type ServerPairing } from '../src/main/remote/pairing-repository';
import { RemoteEngine, type RemoteEngineOptions } from '../src/main/remote/remote-engine';
import type { RemoteFailureKind } from '../src/main/remote/remote-failure';
import { ServerConnector, type ConnectionObserver } from '../src/main/remote/server-connector';
import type { ServerOptions } from '../../server/src/app';
import { ROUTING_MODELS, ROUTING_STT, type FakeSttBehaviour } from '../../server/test/support/fake-stt-server';
import { continuousSpeech, speech } from '../../server/test/support/speech';
import { RecordingLogger } from './recording-logger';
import { startTestGateway, type TestGateway } from './support/gateway';
import { ServerLanguageGate } from '../src/main/remote/server-language-support';
import type { LanguageSelection } from '../src/shared/dictation-languages';
import { DEFAULT_SETTINGS as LANGUAGE_DEFAULTS } from '../src/shared/settings';

const AUTOMATIC = { languages: new ServerLanguageGate(), selection: () => LANGUAGE_DEFAULTS.languages };

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
const scratchDirs: string[] = [];

afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function engine(pairing: ServerPairing | null, options: Partial<RemoteEngineOptions> = {}, observer = new RecordingObserver()): RemoteEngine {
  const connector = new ServerConnector({ pairings: { load: () => Promise.resolve(pairing) }, observer, clock: Date.now, timeoutMs: 2000 });
  return new RemoteEngine({ connector, ...AUTOMATIC, options });
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
    const dictation = (await prepared(engine(pairing))).start({ languages: { mode: 'auto', selected: ['sk'] }, signal: new AbortController().signal });

    talk(dictation, continuousSpeech(26));

    expect(await dictation.finish()).toBe('ahoj toto je prvá časť a koniec diktátu');
    expect(server.stt.requests).toEqual([
      { language: 'auto', bytes: 25 * SECOND },
      { language: 'auto', bytes: 2 * SECOND },
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
    const dictation = (await prepared(engine(pairing))).start({ languages: { mode: 'auto', selected: ['cs'] }, signal: new AbortController().signal });

    talk(dictation, speech(26));

    expect(await dictation.finish()).toBe('prvá veta');
    expect(server.stt.requests).toHaveLength(2);
  });

  describe('with selected languages', () => {
    const SLOVAK_AND_CZECH: LanguageSelection = { mode: 'selected', selected: ['sk', 'cs'] };

    async function storedConnector(pairing: ServerPairing): Promise<ServerConnector> {
      const dir = await mkdtemp(join(tmpdir(), 'cw-remote-languages-'));
      scratchDirs.push(dir);
      const pairings = new EncryptedPairingFile(join(dir, 'server-pairing.json'), new InsecureTestVault(), new RecordingLogger());
      await pairings.save(pairing);
      return new ServerConnector({ pairings, observer: new RecordingObserver(), clock: Date.now, timeoutMs: 2000 });
    }

    async function restricted(pairing: ServerPairing, selection: LanguageSelection = SLOVAK_AND_CZECH): Promise<RemoteEngine> {
      return new RemoteEngine({ connector: await storedConnector(pairing), languages: new ServerLanguageGate(), selection: () => selection });
    }

    const echoLanguages: FakeSttBehaviour = {
      capabilities: ROUTING_STT,
      respond: (_pcm, _language, request) => ({ status: 200, body: { text: `prepis v ${request.languages?.join(' a ') ?? 'auto'}`, language: request.languages?.[0] ?? null, route: 'conditioned' } }),
    };

    it('routes them on a current server with the models and sends the ordered list to the STT', async () => {
      const { gateway: server, pairing } = await startWith(echoLanguages);
      const dictation = (await prepared(await restricted(pairing))).start({ languages: SLOVAK_AND_CZECH, signal: new AbortController().signal });

      speak(dictation, SECOND);

      expect(await dictation.finish()).toBe('prepis v sk a cs');
      expect(server.stt.requests).toEqual([{ language: 'auto', languages: ['sk', 'cs'], kind: 'final', bytes: SECOND }]);
    });

    it('refuses them on a server older than 0.3.0 without sending any audio', async () => {
      const { gateway: server, pairing } = await startWith(echoLanguages, { serverVersion: '0.2.7' });

      expect(await (await restricted(pairing)).prepare()).toEqual({ ready: false, reason: 'server-languages-outdated' });
      expect(server.stt.requests).toEqual([]);
      await expect.poll(() => server.server.gateway.sessions.count()).toBe(0);
    });

    it('refuses them on a current server without the language models', async () => {
      const { gateway: server, pairing } = await startWith(bySize);

      expect(await (await restricted(pairing)).prepare()).toEqual({ ready: false, reason: 'server-languages-missing' });
      expect(server.stt.requests).toEqual([]);
    });

    it('refuses a selection the server routes only in part', async () => {
      const { pairing } = await startWith({ ...echoLanguages, capabilities: { status: 200, body: { languages: ['sk', 'en'], models: ROUTING_MODELS } } });

      expect(await (await restricted(pairing)).prepare()).toEqual({ ready: false, reason: 'server-languages-missing' });
      expect(await (await restricted(pairing, { mode: 'selected', selected: ['en', 'sk'] })).prepare()).toMatchObject({ ready: true });
    });

    it('still dictates automatically on an outdated server', async () => {
      const { gateway: server, pairing } = await startWith(bySize, { serverVersion: '0.2.7' });
      const dictation = (await prepared(await restricted(pairing, { mode: 'auto', selected: ['sk'] }))).start({ languages: { mode: 'auto', selected: ['sk'] }, signal: new AbortController().signal });

      speak(dictation, SECOND);

      expect(await dictation.finish()).toBe(`úsek${SECOND}`);
      expect(server.stt.requests).toEqual([{ language: 'auto', bytes: SECOND }]);
    });

    it('refuses a session that asks for them after an automatic preparation on a server without the models', async () => {
      const { gateway: server, pairing } = await startWith(bySize);
      const remote = await prepared(engine(pairing));

      expect(() => remote.start({ languages: SLOVAK_AND_CZECH, signal: new AbortController().signal })).toThrow(new EngineUnavailableError('server-languages-missing'));
      expect(server.stt.requests).toEqual([]);
    });

    it('reports missing models when the server lost them after the preparation', async () => {
      const { gateway: server, pairing } = await startWith(echoLanguages);
      const remote = await prepared(await restricted(pairing));
      server.stt.setCapabilities({ status: 404, body: { error: 'not found' } });
      const other = await (await storedConnector(pairing)).connect();
      other.connection.close();
      const dictation = remote.start({ languages: SLOVAK_AND_CZECH, signal: new AbortController().signal });

      speak(dictation, SECOND);

      await expect(dictation.finish()).rejects.toMatchObject({ reason: 'languages-missing', textSoFar: '' });
      expect(server.stt.requests).toEqual([]);
    });

    it('keeps the earlier text when the models disappear during the dictation', async () => {
      const { gateway: server, pairing } = await startWith(echoLanguages);
      const dictation = (await prepared(await restricted(pairing))).start({ languages: SLOVAK_AND_CZECH, signal: new AbortController().signal });
      talk(dictation, continuousSpeech(25));
      await expect.poll(() => server.stt.requests.length).toBe(1);
      server.stt.setCapabilities({ status: 404, body: { error: 'not found' } });

      talk(dictation, continuousSpeech(3));

      await expect(dictation.finish()).rejects.toMatchObject({ reason: 'languages-missing', textSoFar: 'prepis v sk a cs' });
    });
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
    const busy = (await prepared(engine(pairing))).start({ languages: { mode: 'auto', selected: ['sk'] }, signal: new AbortController().signal });
    speak(busy, SECOND);
    await expect(busy.finish()).rejects.toEqual(new TranscriptionFailedError('busy'));
    await server.close();

    const broken = await startWith({ respond: () => ({ status: 500, body: { error: 'boom' } }) });
    const failing = (await prepared(engine(broken.pairing))).start({ languages: { mode: 'auto', selected: ['sk'] }, signal: new AbortController().signal });
    speak(failing, SECOND);
    await expect(failing.finish()).rejects.toMatchObject({ reason: 'stt-unavailable', textSoFar: '' });
  });

  it('keeps the text recognised before a later segment failed', async () => {
    const { pairing } = await startWith({ respond: (pcm) => (pcm.length === 2 * SECOND ? { status: 500, body: {} } : { status: 200, body: { text: 'toto je začiatok' } }) });
    const dictation = (await prepared(engine(pairing))).start({ languages: { mode: 'auto', selected: ['sk'] }, signal: new AbortController().signal });

    talk(dictation, continuousSpeech(26));

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'stt-unavailable', textSoFar: 'toto je začiatok' });
  });

  it('reports a dictation longer than the server allows', async () => {
    const clock = { now: Date.now() };
    const { pairing } = await startWith(bySize, { clock: () => clock.now });
    const dictation = (await prepared(engine(pairing))).start({ languages: { mode: 'auto', selected: ['sk'] }, signal: new AbortController().signal });

    await talkInRealTime(dictation, speech(601), clock);

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'too-long' });
  });

  it('cancels a dictation on abort and the gateway aborts its STT call', async () => {
    const { gateway: server, pairing } = await startWith({ delayMs: 2000 });
    const controller = new AbortController();
    const dictation = (await prepared(engine(pairing))).start({ languages: { mode: 'auto', selected: ['sk'] }, signal: controller.signal });
    speak(dictation, SECOND);
    const finished = dictation.finish();
    await expect.poll(() => server.stt.requests.length).toBe(1);

    controller.abort();

    await expect(finished).rejects.toMatchObject({ name: 'AbortError' });
    await expect.poll(() => server.stt.aborted()).toBe(1);
  });

  it('gives up when the connected server sends nothing for the finish wait', async () => {
    const { pairing } = await startWith({ delayMs: 5000 });
    const dictation = (await prepared(engine(pairing, { finishIdleMs: 200 }))).start({ languages: { mode: 'auto', selected: ['sk'] }, signal: new AbortController().signal });
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
