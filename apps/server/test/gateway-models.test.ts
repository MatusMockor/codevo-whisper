import type { ServerMessage } from '@codevo-whisper/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { streamLogger } from '../src/logging/logger';
import { MAX_MODEL_LOADS } from '../src/stt/model-ready-gate';
import {
  MODEL_SELECTION_STT,
  PARAKEET_OPTION,
  ROUTING_MODELS,
  ROUTING_STT,
  startFakeSttServer,
  WHISPER_OPTION,
  type FakeSttBehaviour,
  type FakeSttResponse,
  type FakeSttServer,
} from './support/fake-stt-server';
import { sendAudio } from './support/send-audio';
import { startHarness, type Harness } from './support/server-harness';
import { speech } from './support/speech';
import { createTempDir } from './support/temp-dir';
import { connectSession, type TestSession } from './support/test-client';
import { waitUntil } from './support/wait-until';

type DictationLine = { event: string; result: string; routes: Record<string, number> };

const NO_ROUTING: FakeSttResponse = { status: 200, body: { languages: [], models: ROUTING_MODELS, transcriptionModels: [PARAKEET_OPTION, WHISPER_OPTION] } };

const WHISPER_MISSING: FakeSttResponse = { status: 200, body: { ...MODEL_SELECTION_STT.body, transcriptionModels: [PARAKEET_OPTION, { ...WHISPER_OPTION, available: false }] } };

let dir: Awaited<ReturnType<typeof createTempDir>>;
let fake: FakeSttServer;
let harness: Harness | undefined;
let lines: string[];

beforeEach(async () => {
  dir = await createTempDir();
  lines = [];
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await fake.close();
  await dir.remove();
});

async function start(behaviour: FakeSttBehaviour = { capabilities: MODEL_SELECTION_STT }): Promise<Harness> {
  fake = await startFakeSttServer(behaviour);
  harness = await startHarness(dir.path, fake.url, { logger: streamLogger((line) => lines.push(line)) });
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

async function dictate(session: TestSession, start: Extract<Parameters<TestSession['send']>[0], { type: 'start' }>, seconds = 2): Promise<ServerMessage[]> {
  session.send(start);
  sendAudio(session, speech(seconds));
  session.send({ type: 'finish' });
  return collectUntilDone(session);
}

function dictationLines(): DictationLine[] {
  return lines.map((line) => JSON.parse(line) as DictationLine).filter((line) => line.event === 'dictation');
}

describe('transcription model selection on the gateway', () => {
  it('lists the transcription models only to a client that asks for them', async () => {
    const session = await readySession(await start());

    session.send({ type: 'capabilities' });
    expect(await session.next()).toStrictEqual({ type: 'capabilities', languages: MODEL_SELECTION_STT.body.languages, models: ROUTING_MODELS });
    session.send({ type: 'capabilities', transcriptionModels: false });
    expect(await session.next()).toStrictEqual({ type: 'capabilities', languages: MODEL_SELECTION_STT.body.languages, models: ROUTING_MODELS });
    session.send({ type: 'capabilities', transcriptionModels: true });
    expect(await session.next()).toEqual({
      type: 'capabilities',
      languages: MODEL_SELECTION_STT.body.languages,
      models: ROUTING_MODELS,
      transcriptionModels: [PARAKEET_OPTION, WHISPER_OPTION],
    });
  });

  it('lists no transcription models when the stt predates model selection or is unreachable', async () => {
    const session = await readySession(await start({ capabilities: ROUTING_STT }));
    session.send({ type: 'capabilities', transcriptionModels: true });
    expect(await session.next()).toMatchObject({ transcriptionModels: [] });

    fake.setCapabilities({ status: 404, body: { error: 'not found' } });
    const later = await readySession(harness as Harness);
    later.send({ type: 'capabilities', transcriptionModels: true });
    expect(await later.next()).toMatchObject({ languages: [], transcriptionModels: [] });
  });

  it('forwards the chosen model to the stt for every segment of the session', async () => {
    const session = await readySession(await start());

    expect(await dictate(session, { type: 'start', sessionId: 's1', language: 'sk', model: 'whisper-large-v3' }, 2)).toEqual([
      { type: 'final', sessionId: 's1', segmentId: 0, text: 'ahoj svet' },
      { type: 'done', sessionId: 's1' },
    ]);
    expect(fake.requests).toEqual([{ language: 'sk', model: 'whisper-large-v3', bytes: 64_000 }]);
  });

  it('sends no model to the stt for a session without one, even when the stt offers models', async () => {
    const session = await readySession(await start());

    await dictate(session, { type: 'start', sessionId: 's1', language: 'sk' });

    expect(fake.requests).toStrictEqual([{ language: 'sk', bytes: 64_000 }]);
  });

  it('passes the languages and vocabulary of a Whisper session and counts the direct route', async () => {
    const session = await readySession(
      await start({ capabilities: MODEL_SELECTION_STT, respond: (_pcm, _language, request) => ({ status: 200, body: { text: 'ahoj', language: request.languages?.[0] ?? null, route: 'direct' } }) }),
    );

    expect(await dictate(session, { type: 'start', sessionId: 's1', language: 'auto', languages: ['sk'], vocabulary: ['Kumiba'], model: 'whisper-large-v3' })).toEqual([
      { type: 'final', sessionId: 's1', segmentId: 0, text: 'ahoj', language: 'sk' },
      { type: 'done', sessionId: 's1' },
    ]);
    expect(fake.requests).toEqual([{ language: 'auto', languages: ['sk'], kind: 'final', vocabulary: ['Kumiba'], model: 'whisper-large-v3', bytes: 64_000 }]);
    await waitUntil(() => dictationLines().length === 1);
    expect(dictationLines()[0]?.routes).toEqual({ direct: 1 });
  });

  it('keeps the model choice of one device away from the sessions of another', async () => {
    const server = await start({ capabilities: MODEL_SELECTION_STT, delayMs: 50 });
    const whisper = await readySession(server);
    const parakeet = await readySession(server);

    const [whisperMessages, parakeetMessages] = await Promise.all([
      dictate(whisper, { type: 'start', sessionId: 'w1', language: 'sk', model: 'whisper-large-v3' }),
      dictate(parakeet, { type: 'start', sessionId: 'p1', language: 'sk' }),
    ]);
    await dictate(parakeet, { type: 'start', sessionId: 'p2', language: 'sk', model: 'parakeet-ultra' });

    expect(whisperMessages.at(-1)).toEqual({ type: 'done', sessionId: 'w1' });
    expect(parakeetMessages.at(-1)).toEqual({ type: 'done', sessionId: 'p1' });
    expect(fake.requests.map((request) => request.model ?? 'default').sort()).toEqual(['default', 'parakeet-ultra', 'whisper-large-v3']);
  });

  it('keeps dictating another device on the default model while the selected model of one device loads', async () => {
    const server = await start({ capabilities: MODEL_SELECTION_STT, loadDelayMs: { 'whisper-large-v3': 1500 } });
    const whisper = await readySession(server);
    const parakeet = await readySession(server);

    const whisperMessages = dictate(whisper, { type: 'start', sessionId: 'w1', language: 'sk', model: 'whisper-large-v3' });
    await waitUntil(() => fake.loadingModels().includes('whisper-large-v3'));
    const parakeetMessages = await dictate(parakeet, { type: 'start', sessionId: 'p1', language: 'sk' });

    expect(parakeetMessages).toEqual([
      { type: 'final', sessionId: 'p1', segmentId: 0, text: 'ahoj svet' },
      { type: 'done', sessionId: 'p1' },
    ]);
    expect(fake.loadedModels()).toEqual([]);
    expect(await whisperMessages).toEqual([
      { type: 'final', sessionId: 'w1', segmentId: 0, text: 'ahoj svet' },
      { type: 'done', sessionId: 'w1' },
    ]);
    expect(fake.loadedModels()).toEqual(['whisper-large-v3']);
  });

  it('starts loading the selected model as soon as the session starts', async () => {
    const session = await readySession(await start({ capabilities: MODEL_SELECTION_STT, loadDelayMs: { 'whisper-large-v3': 300 } }));

    session.send({ type: 'start', sessionId: 'w1', language: 'sk', model: 'whisper-large-v3' });

    await waitUntil(() => fake.loadingModels().includes('whisper-large-v3'));
    expect(fake.preparations()).toEqual(['whisper-large-v3']);
    expect(fake.requests).toEqual([]);
  });

  it('drops the segments waiting for the model when the dictation is cancelled', async () => {
    const session = await readySession(await start({ capabilities: MODEL_SELECTION_STT, loadDelayMs: { 'whisper-large-v3': 300 } }));

    session.send({ type: 'start', sessionId: 'w1', language: 'sk', model: 'whisper-large-v3' });
    sendAudio(session, speech(2));
    session.send({ type: 'finish' });
    session.send({ type: 'cancel' });

    expect(await session.next()).toEqual({ type: 'done', sessionId: 'w1' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fake.requests).toEqual([]);
  });

  it('fails the dictation with stt_unavailable when the selected model fails to load and keeps the default model', async () => {
    const session = await readySession(await start({ capabilities: MODEL_SELECTION_STT, failingLoads: ['whisper-large-v3'] }));

    expect(await dictate(session, { type: 'start', sessionId: 'w1', language: 'sk', model: 'whisper-large-v3' })).toEqual([
      { type: 'final', sessionId: 'w1', segmentId: 0, text: '' },
      { type: 'error', code: 'stt_unavailable', message: 'stt_unavailable', sessionId: 'w1' },
    ]);
    expect(await dictate(session, { type: 'start', sessionId: 'p1', language: 'sk' })).toMatchObject([{ type: 'final', text: 'ahoj svet' }, { type: 'done', sessionId: 'p1' }]);
    expect(fake.requests).toStrictEqual([{ language: 'sk', bytes: 64_000 }]);
  });

  it('waits for the model again outside the inference slot when the stt reports it loading after it was ready', async () => {
    let loading = 1;
    const respond = (): FakeSttResponse => (loading-- > 0 ? { status: 503, body: { error: 'model loading' } } : { status: 200, body: { text: 'ahoj svet' } });
    const session = await readySession(await start({ capabilities: MODEL_SELECTION_STT, respond }));

    expect(await dictate(session, { type: 'start', sessionId: 'w1', language: 'sk', model: 'whisper-large-v3' })).toEqual([
      { type: 'final', sessionId: 'w1', segmentId: 0, text: 'ahoj svet' },
      { type: 'done', sessionId: 'w1' },
    ]);
    expect(fake.preparations()).toEqual(['whisper-large-v3', 'whisper-large-v3']);
  });

  it('gives up with stt_unavailable when the stt keeps reporting the model loading', async () => {
    const session = await readySession(await start({ capabilities: MODEL_SELECTION_STT, respond: () => ({ status: 503, body: { error: 'model loading' } }) }));

    expect(await dictate(session, { type: 'start', sessionId: 'w1', language: 'sk', model: 'whisper-large-v3' })).toEqual([
      { type: 'final', sessionId: 'w1', segmentId: 0, text: '' },
      { type: 'error', code: 'stt_unavailable', message: 'stt_unavailable', sessionId: 'w1' },
    ]);
    expect(fake.preparations()).toHaveLength(MAX_MODEL_LOADS);
  });

  it('accepts dictation languages for a model that skips routing while the stt cannot route languages', async () => {
    const respond = (): FakeSttResponse => ({ status: 200, body: { text: 'ahoj', language: null, route: 'direct' } });
    const session = await readySession(await start({ capabilities: NO_ROUTING, respond }));

    expect(await dictate(session, { type: 'start', sessionId: 'w1', language: 'auto', languages: ['sk', 'en'], model: 'whisper-large-v3' })).toEqual([
      { type: 'final', sessionId: 'w1', segmentId: 0, text: 'ahoj', language: null },
      { type: 'done', sessionId: 'w1' },
    ]);
    expect(fake.requests).toEqual([{ language: 'auto', languages: ['sk', 'en'], kind: 'final', model: 'whisper-large-v3', bytes: 64_000 }]);

    session.send({ type: 'start', sessionId: 'p1', language: 'auto', languages: ['sk', 'en'] });
    expect(await session.next()).toEqual({ type: 'error', code: 'languages_unavailable', message: 'languages_unavailable', sessionId: 'p1' });
    session.send({ type: 'start', sessionId: 'p2', language: 'auto', languages: ['sk', 'en'], model: 'parakeet-ultra' });
    expect(await session.next()).toEqual({ type: 'error', code: 'languages_unavailable', message: 'languages_unavailable', sessionId: 'p2' });
    expect(fake.requests).toHaveLength(1);
  });

  it('refuses an unavailable or unknown model at start and keeps the connection for the default model', async () => {
    const session = await readySession(await start({ capabilities: WHISPER_MISSING }));

    session.send({ type: 'start', sessionId: 's1', language: 'sk', model: 'whisper-large-v3' });
    expect(await session.next()).toEqual({ type: 'error', code: 'model_unavailable', message: 'model_unavailable', sessionId: 's1' });
    session.send({ type: 'start', sessionId: 's2', language: 'auto', languages: ['sk'], model: 'canary-1b-v2' });
    expect(await session.next()).toEqual({ type: 'error', code: 'model_unavailable', message: 'model_unavailable', sessionId: 's2' });

    expect(await dictate(session, { type: 'start', sessionId: 's3', language: 'sk' })).toMatchObject([{ type: 'final', text: 'ahoj svet' }, { type: 'done', sessionId: 's3' }]);
    expect(fake.requests).toStrictEqual([{ language: 'sk', bytes: 64_000 }]);
  });

  it('refuses every model when the stt predates model selection instead of falling back to the default', async () => {
    const session = await readySession(await start({ capabilities: ROUTING_STT }));

    session.send({ type: 'start', sessionId: 's1', language: 'sk', model: 'parakeet-ultra' });

    expect(await session.next()).toEqual({ type: 'error', code: 'model_unavailable', message: 'model_unavailable', sessionId: 's1' });
    expect(fake.requests).toEqual([]);
  });

  it('reports model_unavailable when the model disappears after the capability check', async () => {
    const session = await readySession(await start());
    fake.setCapabilities(WHISPER_MISSING);

    expect(await dictate(session, { type: 'start', sessionId: 's1', language: 'sk', model: 'whisper-large-v3' })).toEqual([
      { type: 'final', sessionId: 's1', segmentId: 0, text: '' },
      { type: 'error', code: 'model_unavailable', message: 'model_unavailable', sessionId: 's1' },
    ]);
    await waitUntil(() => dictationLines().length === 1);
    expect(dictationLines()[0]?.result).toBe('model_unavailable');
  });

  it('rejects a malformed model id as a bad message', async () => {
    const session = await readySession(await start());

    session.send({ type: 'start', sessionId: 's1', language: 'sk', model: 'Whisper Large' });

    expect(await session.next()).toMatchObject({ type: 'error', code: 'bad_message' });
  });
});
