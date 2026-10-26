import { generateKeyPair, type ClientMessage } from '@codevo-whisper/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { DictationOptions, EngineDictation, Preparation, TranscriptUpdate } from '../src/main/engines/transcription-engine';
import { MAX_SEGMENT_ID } from '../src/main/remote/remote-dictation';
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

async function startDictation(engine: RemoteEngine, extra: Partial<DictationOptions> = {}): Promise<EngineDictation> {
  const preparation = await engine.prepare();
  expect(preparation).toMatchObject({ ready: true });
  return (preparation as Extract<Preparation, { ready: true }>).engine.start({ language: 'en', signal: new AbortController().signal, ...extra });
}

function ownAndForeignResults(session: ResponderSession, message: ClientMessage): void {
  if (message.type === 'start') {
    const { sessionId } = message;
    session.send({ type: 'final', sessionId: 'old-session', segmentId: 0, text: 'cudzí text' });
    session.send({ type: 'partial', sessionId: 'old-session', segmentId: 0, revision: 4, text: 'cudzí návrh' });
    session.send({ type: 'partial', sessionId, segmentId: 0, revision: 1, text: 'tentatívne' });
    session.send({ type: 'final', sessionId, segmentId: 1, text: 'druhý' });
    session.send({ type: 'final', sessionId, segmentId: 0, text: 'prvý' });
    finishWith.set(session, sessionId);
    return;
  }
  if (message.type === 'finish') {
    session.send({ type: 'done', sessionId: 'old-session' });
    session.send({ type: 'done', sessionId: finishWith.get(session) ?? '' });
  }
}

const finishWith = new WeakMap<ResponderSession, string>();

describe('RemoteDictation protocol handling', () => {
  it('surfaces partials and finals of its own session in Živý text and ignores other sessions', async () => {
    const engine = await scripted(ownAndForeignResults);
    const updates: TranscriptUpdate[] = [];
    const dictation = await startDictation(engine, { partials: true, onTranscript: (update) => updates.push(update) });
    dictation.push(new Uint8Array(3200));

    expect(await dictation.finish()).toBe('prvý druhý');
    expect(updates).toEqual([
      { type: 'partial', segmentId: 0, revision: 1, text: 'tentatívne' },
      { type: 'final', segmentId: 1, text: 'druhý' },
      { type: 'final', segmentId: 0, text: 'prvý' },
    ]);
  });

  it('surfaces finals but never partials in Indikátor mode', async () => {
    const engine = await scripted(ownAndForeignResults);
    const updates: TranscriptUpdate[] = [];
    const dictation = await startDictation(engine, { onTranscript: (update) => updates.push(update) });
    dictation.push(new Uint8Array(3200));

    expect(await dictation.finish()).toBe('prvý druhý');
    expect(updates).toEqual([
      { type: 'final', segmentId: 1, text: 'druhý' },
      { type: 'final', segmentId: 0, text: 'prvý' },
    ]);
  });

  it('rejects a partial for a segment far beyond any real dictation', async () => {
    const engine = await scripted((session, message) => {
      if (message.type === 'start') {
        session.send({ type: 'partial', sessionId: message.sessionId, segmentId: MAX_SEGMENT_ID + 1, revision: 1, text: 'priveľa' });
      }
    });
    const updates: TranscriptUpdate[] = [];
    const dictation = await startDictation(engine, { partials: true, onTranscript: (update) => updates.push(update) });
    dictation.push(new Uint8Array(3200));

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'protocol' });
    expect(updates).toEqual([]);
  });

  it('holds audio and the finish while the server pauses the flow, also after the key was released', async () => {
    let sessionId = '';
    let held: string[] = [];
    let audioFrames = 0;
    const engine = await scripted((session, message) => {
      if (message.type === 'start') {
        sessionId = message.sessionId;
        session.send({ type: 'flow', paused: true });
        setTimeout(() => {
          held = session.received.map((received) => received.type);
          session.send({ type: 'flow', paused: false });
        }, 150);
        return;
      }
      if (message.type === 'finish') {
        audioFrames = session.received.filter((received) => received.type === 'audio').length;
        session.send({ type: 'done', sessionId });
      }
    });
    const dictation = await startDictation(engine);
    await new Promise((resolve) => setTimeout(resolve, 50));

    for (let index = 0; index < 30; index += 1) {
      dictation.push(new Uint8Array(3200));
    }
    const finished = dictation.finish();

    expect(await finished).toBe('');
    expect(held).toEqual(['hello', 'start']);
    expect(audioFrames).toBe(3);
  });

  it('asks for partials only in Živý text mode and never sends false', async () => {
    const starts: string[] = [];
    const engine = await scripted((session, message) => {
      if (message.type !== 'start') {
        return;
      }
      starts.push(new TextDecoder().decode(session.plaintexts.at(-1)?.subarray(1)));
      session.send({ type: 'done', sessionId: message.sessionId });
    });

    for (const partials of [true, false, undefined]) {
      const preparation = await engine.prepare();
      const options = partials === undefined ? { language: 'sk' as const, signal: new AbortController().signal } : { language: 'sk' as const, signal: new AbortController().signal, partials };
      const dictation = (preparation as Extract<Preparation, { ready: true }>).engine.start(options);
      await dictation.finish();
    }

    expect(starts.map((json) => (JSON.parse(json) as { partials?: unknown }).partials)).toEqual([true, undefined, undefined]);
    expect(starts.slice(1).every((json) => !json.includes('partials'))).toBe(true);
  });

  it('reports a failed segment that arrives as an empty final and an error, keeping the earlier text', async () => {
    const engine = await scripted((session, message) => {
      if (message.type === 'start') {
        session.send({ type: 'final', sessionId: message.sessionId, segmentId: 0, text: 'prvý' });
        session.send({ type: 'final', sessionId: message.sessionId, segmentId: 1, text: '' });
        session.send({ type: 'error', code: 'stt_unavailable', message: 'stt_unavailable', sessionId: message.sessionId });
      }
    });
    const dictation = await startDictation(engine);

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'stt-unavailable', textSoFar: 'prvý' });
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

  it('rejects a segment id far beyond any real dictation', async () => {
    const engine = await scripted((session, message) => {
      if (message.type === 'start') {
        session.send({ type: 'final', sessionId: message.sessionId, segmentId: 4294967294, text: 'x' });
      }
    });
    const dictation = await startDictation(engine);

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'protocol' });
  });

  it('rejects a transcript that grows beyond the overall text limit', async () => {
    const engine = await scripted((session, message) => {
      if (message.type === 'start') {
        for (let segmentId = 0; segmentId < 20; segmentId += 1) {
          session.send({ type: 'final', sessionId: message.sessionId, segmentId, text: 'á'.repeat(16000) });
        }
      }
    });
    const dictation = await startDictation(engine);

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'protocol' });
  });

  it('never sends anything for a dictation whose signal is already aborted', async () => {
    const received: string[] = [];
    const engine = await scripted((_session, message) => received.push(message.type));
    const preparation = await engine.prepare();
    const controller = new AbortController();
    controller.abort();

    const dictation = (preparation as Extract<Preparation, { ready: true }>).engine.start({ language: 'sk', signal: controller.signal });
    dictation.push(new Uint8Array(3200));

    await expect(dictation.finish()).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toEqual([]);
  });
});
