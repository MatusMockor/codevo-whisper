import { generateKeyPair, type ClientMessage } from '@codevo-whisper/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { EngineDictation, Preparation } from '../src/main/engines/transcription-engine';
import { RemoteEngine } from '../src/main/remote/remote-engine';
import { ServerConnector } from '../src/main/remote/server-connector';
import { acceptSession, startResponder, type ResponderSession, type ScriptedResponder } from './support/scripted-responder';

let responder: ScriptedResponder | undefined;

afterEach(async () => {
  await responder?.close();
  responder = undefined;
});

const silentObserver = { connected: () => undefined, failed: () => undefined };

async function scripted(script: (session: ResponderSession, message: ClientMessage) => void): Promise<RemoteEngine> {
  const serverKey = generateKeyPair();
  responder = await startResponder((socket, opening) => {
    const session = acceptSession(socket, opening, serverKey);
    session.onMessage((message) => {
      if (message.type === 'hello') {
        session.send({ type: 'ready', serverVersion: 'test' });
        return;
      }
      script(session, message);
    });
  });
  const pairing = { deviceKey: generateKeyPair(), serverPublicKey: serverKey.publicKey, endpoint: responder.url, deviceId: 'abcdef01', deviceName: 'Mac', pairedAt: '2026-10-26T08:00:00.000Z' };
  const connector = new ServerConnector({ pairings: { load: () => Promise.resolve(pairing) }, observer: silentObserver, clock: Date.now, timeoutMs: 2000 });
  return new RemoteEngine({ connector, observer: silentObserver });
}

async function startDictation(engine: RemoteEngine): Promise<EngineDictation> {
  const preparation = await engine.prepare();
  expect(preparation).toMatchObject({ ready: true });
  return (preparation as Extract<Preparation, { ready: true }>).engine.start({ language: 'en', signal: new AbortController().signal });
}

describe('RemoteDictation protocol handling', () => {
  it('ignores partials and results of other sessions', async () => {
    let sessionId = '';
    const engine = await scripted((session, message) => {
      if (message.type === 'start') {
        sessionId = message.sessionId;
        session.send({ type: 'final', sessionId: 'old-session', segmentId: 0, text: 'cudzí text' });
        session.send({ type: 'partial', sessionId, segmentId: 0, revision: 1, text: 'tentatívne' });
        session.send({ type: 'final', sessionId, segmentId: 1, text: 'druhý' });
        session.send({ type: 'final', sessionId, segmentId: 0, text: 'prvý' });
        return;
      }
      if (message.type === 'finish') {
        session.send({ type: 'done', sessionId: 'old-session' });
        session.send({ type: 'done', sessionId });
      }
    });
    const dictation = await startDictation(engine);
    dictation.push(new Uint8Array(3200));

    expect(await dictation.finish()).toBe('prvý druhý');
  });

  it('holds audio while the server pauses the flow and sends it all on finish', async () => {
    let sessionId = '';
    let audioBeforeFinish = -1;
    const engine = await scripted((session, message) => {
      if (message.type === 'start') {
        sessionId = message.sessionId;
        session.send({ type: 'flow', paused: true });
        return;
      }
      if (message.type === 'finish') {
        audioBeforeFinish = session.received.filter((received) => received.type === 'audio').length;
        session.send({ type: 'done', sessionId });
      }
    });
    const dictation = await startDictation(engine);
    await new Promise((resolve) => setTimeout(resolve, 50));

    for (let index = 0; index < 30; index += 1) {
      dictation.push(new Uint8Array(3200));
    }

    expect(await dictation.finish()).toBe('');
    expect(audioBeforeFinish).toBe(3);
  });

  it('fails with a protocol error on an unexpected message', async () => {
    const engine = await scripted((session, message) => {
      if (message.type === 'start') {
        session.send({ type: 'pair-result', status: 'rejected' });
      }
    });
    const dictation = await startDictation(engine);

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'protocol' });
  });
});
