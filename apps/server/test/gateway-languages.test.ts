import { encodeServerMessage, UNKNOWN_MODELS, type ServerMessage } from '@codevo-whisper/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { streamLogger } from '../src/logging/logger';
import { ROUTING_MODELS, ROUTING_STT, startFakeSttServer, type FakeSttBehaviour, type FakeSttServer } from './support/fake-stt-server';
import { MessageLog } from './support/message-log';
import { streamPaced, type ManualClock } from './support/paced-audio';
import { pcmSeconds } from './support/pcm';
import { sendAudio } from './support/send-audio';
import { startHarness, type Harness } from './support/server-harness';
import { continuousSpeech, speech } from './support/speech';
import { createTempDir } from './support/temp-dir';
import { connectSession, type TestSession } from './support/test-client';
import { waitUntil } from './support/wait-until';

type DictationLine = { event: string; result: string; finals: number; routes: Record<string, number> };

let dir: Awaited<ReturnType<typeof createTempDir>>;
let fake: FakeSttServer;
let harness: Harness | undefined;
let clock: ManualClock;
let lines: string[];

beforeEach(async () => {
  dir = await createTempDir();
  clock = { now: 1_000_000 };
  lines = [];
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await fake.close();
  await dir.remove();
});

async function start(behaviour: FakeSttBehaviour = { capabilities: ROUTING_STT }): Promise<Harness> {
  fake = await startFakeSttServer(behaviour);
  harness = await startHarness(dir.path, fake.url, { clock: () => clock.now, logger: streamLogger((line) => lines.push(line)) });
  return harness;
}

async function readySession(server: Harness): Promise<TestSession> {
  const device = await server.addDevice();
  const session = await connectSession(server.url, device, server.serverKey.publicKey);
  expect(await session.next()).toMatchObject({ type: 'ready' });
  return session;
}

async function collectUntilDone(session: TestSession): Promise<ServerMessage[]> {
  const messages: ServerMessage[] = [];
  for (;;) {
    const message = await session.next();
    messages.push(message);
    if (message.type === 'done' || message.type === 'error') {
      return messages;
    }
  }
}

function dictationLines(): DictationLine[] {
  return lines.map((line) => JSON.parse(line) as DictationLine).filter((line) => line.event === 'dictation');
}

function routeResponder(routes: string[]): NonNullable<FakeSttBehaviour['respond']> {
  let calls = 0;
  return (_pcm, _language, request) => {
    calls += 1;
    return { status: 200, body: { text: `veta ${calls}`, language: request.languages?.at(-1) ?? null, route: routes[(calls - 1) % routes.length] } };
  };
}

describe('dictation languages on the gateway', () => {
  it('answers capabilities with the languages and models of the stt sidecar', async () => {
    const session = await readySession(await start());
    session.send({ type: 'capabilities' });

    expect(await session.next()).toEqual({ type: 'capabilities', languages: ROUTING_STT.body.languages, models: ROUTING_MODELS });
  });

  it('answers no languages and unknown models when the stt predates capabilities', async () => {
    const session = await readySession(await start({}));
    session.send({ type: 'capabilities' });

    expect(await session.next()).toEqual({ type: 'capabilities', languages: [], models: UNKNOWN_MODELS });
  });

  it('reports the models of an stt without the routing models', async () => {
    const models = { transcription: 'Parakeet Ultra (F16)', conditioned: null, languageId: null };
    const session = await readySession(await start({ capabilities: { status: 200, body: { languages: [], models } } }));
    session.send({ type: 'capabilities' });

    expect(await session.next()).toEqual({ type: 'capabilities', languages: [], models });
  });

  it('refreshes the capabilities on every connection', async () => {
    const server = await start({});
    const before = await readySession(server);
    before.send({ type: 'capabilities' });
    expect(await before.next()).toMatchObject({ languages: [] });

    fake.setCapabilities(ROUTING_STT);
    const after = await readySession(server);
    after.send({ type: 'capabilities' });

    expect(await after.next()).toEqual({ type: 'capabilities', languages: ROUTING_STT.body.languages, models: ROUTING_MODELS });
    expect(fake.capabilityRequests()).toBeGreaterThanOrEqual(3);
  });

  it('routes a dictation with languages and adds the detected language to finals', async () => {
    const session = await readySession(await start());
    session.send({ type: 'start', sessionId: 's1', language: 'auto', languages: ['sk', 'cs'] });
    sendAudio(session, speech(2));
    session.send({ type: 'finish' });

    expect(await collectUntilDone(session)).toEqual([
      { type: 'final', sessionId: 's1', segmentId: 0, text: 'ahoj svet', language: 'sk' },
      { type: 'done', sessionId: 's1' },
    ]);
    expect(fake.requests).toEqual([{ language: 'auto', languages: ['sk', 'cs'], kind: 'final', bytes: 64_000 }]);
  });

  it('sends a null language for a segment the stt could not attribute', async () => {
    const session = await readySession(await start({ capabilities: ROUTING_STT, respond: () => ({ status: 200, body: { text: 'ok', language: null, route: 'verbatim-unsure' } }) }));
    session.send({ type: 'start', sessionId: 's1', language: 'auto', languages: ['sk', 'cs', 'en'] });
    sendAudio(session, speech(2));
    session.send({ type: 'finish' });

    expect(await collectUntilDone(session)).toEqual([
      { type: 'final', sessionId: 's1', segmentId: 0, text: 'ok', language: null },
      { type: 'done', sessionId: 's1' },
    ]);
  });

  it('adds the language to partials of a live language dictation and asks the stt for partial routing', async () => {
    const session = await readySession(await start({ capabilities: ROUTING_STT, respond: routeResponder(['conditioned']) }));
    const log = new MessageLog(session);
    session.send({ type: 'start', sessionId: 's1', language: 'auto', partials: true, languages: ['sk', 'cs'] });
    await streamPaced([session], speech(20), { clock, yieldMs: 3 });
    session.send({ type: 'finish' });
    await log.waitFor((message) => message.type === 'done');

    const partials = log.messages.filter((message) => message.type === 'partial');
    const finals = log.messages.filter((message) => message.type === 'final');
    expect(partials.length).toBeGreaterThan(0);
    expect(partials.every((message) => message.language === 'cs')).toBe(true);
    expect(finals.every((message) => message.language === 'cs')).toBe(true);
    expect(new Set(fake.requests.map((request) => request.kind))).toEqual(new Set(['partial', 'final']));
  });

  it('keeps a legacy dictation byte-identical even when the stt can route', async () => {
    const session = await readySession(await start());
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, speech(2));
    session.send({ type: 'finish' });

    const [final] = await collectUntilDone(session);
    expect(final).toStrictEqual({ type: 'final', sessionId: 's1', segmentId: 0, text: 'ahoj svet' });
    expect(encodeServerMessage(final ?? { type: 'flow', paused: false })).toEqual(
      encodeServerMessage({ type: 'final', sessionId: 's1', segmentId: 0, text: 'ahoj svet' }),
    );
    expect(fake.requests).toStrictEqual([{ language: 'sk', bytes: 64_000 }]);
  });

  it('keeps legacy partials without a language field', async () => {
    const session = await readySession(await start());
    const log = new MessageLog(session);
    session.send({ type: 'start', sessionId: 's1', language: 'sk', partials: true });
    await streamPaced([session], speech(6), { clock, yieldMs: 3 });
    session.send({ type: 'finish' });
    await log.waitFor((message) => message.type === 'done');

    const transcripts = log.messages.filter((message) => message.type === 'partial' || message.type === 'final');
    expect(transcripts.some((message) => message.type === 'partial')).toBe(true);
    expect(transcripts.every((message) => !('language' in message))).toBe(true);
    expect(fake.requests.every((request) => request.languages === undefined && request.kind === undefined)).toBe(true);
  });

  it('refuses languages the stt cannot route and keeps the connection for an automatic dictation', async () => {
    const session = await readySession(await start({}));
    session.send({ type: 'start', sessionId: 's1', language: 'auto', languages: ['sk'] });

    expect(await session.next()).toEqual({ type: 'error', code: 'languages_unavailable', message: 'languages_unavailable', sessionId: 's1' });

    session.send({ type: 'start', sessionId: 's2', language: 'auto' });
    sendAudio(session, speech(1));
    session.send({ type: 'finish' });
    expect(await collectUntilDone(session)).toEqual([
      { type: 'final', sessionId: 's2', segmentId: 0, text: 'ahoj svet' },
      { type: 'done', sessionId: 's2' },
    ]);
    expect(fake.requests).toEqual([{ language: 'auto', bytes: 32_000 }]);
  });

  it('refuses a language outside the languages the stt reports', async () => {
    const session = await readySession(await start({ capabilities: { status: 200, body: { languages: ['sk', 'cs'], models: ROUTING_MODELS } } }));
    session.send({ type: 'start', sessionId: 's1', language: 'auto', languages: ['sk', 'en'] });

    expect(await session.next()).toEqual({ type: 'error', code: 'languages_unavailable', message: 'languages_unavailable', sessionId: 's1' });
  });

  it('reports languages_unavailable when the models disappear after the capability check', async () => {
    const session = await readySession(await start());
    fake.setCapabilities({ status: 200, body: { languages: [], models: UNKNOWN_MODELS } });
    session.send({ type: 'start', sessionId: 's1', language: 'auto', languages: ['sk'] });
    sendAudio(session, speech(2));
    session.send({ type: 'finish' });

    expect(await collectUntilDone(session)).toEqual([
      { type: 'final', sessionId: 's1', segmentId: 0, text: '', language: null },
      { type: 'error', code: 'languages_unavailable', message: 'languages_unavailable', sessionId: 's1' },
    ]);

    session.send({ type: 'start', sessionId: 's2', language: 'auto' });
    sendAudio(session, speech(1));
    session.send({ type: 'finish' });
    expect(await collectUntilDone(session)).toMatchObject([{ type: 'final', text: 'ahoj svet' }, { type: 'done', sessionId: 's2' }]);
  });

  it('logs the route counts of a language dictation without any text', async () => {
    const session = await readySession(await start({ capabilities: ROUTING_STT, respond: routeResponder(['conditioned', 'verbatim-unsure', 'conditioned']) }));
    session.send({ type: 'start', sessionId: 's1', language: 'auto', languages: ['sk', 'cs'] });
    sendAudio(session, continuousSpeech(60));
    session.send({ type: 'finish' });
    await collectUntilDone(session);
    await waitUntil(() => dictationLines().length === 1);

    expect(dictationLines()).toMatchObject([{ result: 'ok', finals: 3, routes: { conditioned: 2, 'verbatim-unsure': 1 } }]);
    expect(lines.join('')).not.toContain('veta');
  });

  it('logs empty route counts for an automatic dictation and ignores malformed routes', async () => {
    const server = await start({ capabilities: ROUTING_STT, respond: (_pcm, _language, request) => ({ status: 200, body: { text: 'x', language: null, route: request.languages === undefined ? 'conditioned' : 'secret' } }) });
    const session = await readySession(server);
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, speech(2));
    session.send({ type: 'finish' });
    await collectUntilDone(session);
    session.send({ type: 'start', sessionId: 's2', language: 'auto', languages: ['sk'] });
    sendAudio(session, speech(2));
    session.send({ type: 'finish' });
    await collectUntilDone(session);
    await waitUntil(() => dictationLines().length === 2);

    expect(dictationLines().map((line) => line.routes)).toEqual([{}, {}]);
    expect(lines.join('')).not.toContain('secret');
  });

  it('reports stt_unavailable, never languages_unavailable, when the stt answers 409 to a legacy dictation', async () => {
    const session = await readySession(await start({ capabilities: ROUTING_STT, respond: () => ({ status: 409, body: { error: 'languages unavailable' } }) }));
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, speech(2));
    session.send({ type: 'finish' });

    expect(await collectUntilDone(session)).toStrictEqual([
      { type: 'final', sessionId: 's1', segmentId: 0, text: '' },
      { type: 'error', code: 'stt_unavailable', message: 'stt_unavailable', sessionId: 's1' },
    ]);
  });

  it('logs no route counts for a skipped silent segment and sends it with a null language', async () => {
    const session = await readySession(await start());
    session.send({ type: 'start', sessionId: 's1', language: 'auto', languages: ['sk'] });
    sendAudio(session, pcmSeconds(26));
    session.send({ type: 'finish' });

    const messages = await collectUntilDone(session);
    expect(messages.filter((message) => message.type === 'final').every((message) => message.language === null)).toBe(true);
    await waitUntil(() => dictationLines().length === 1);
    expect(dictationLines()[0]?.routes).toEqual({});
    expect(fake.requests).toEqual([]);
  });
});
