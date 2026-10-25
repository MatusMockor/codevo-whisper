import { MAX_TEXT_CHARS, type ServerMessage } from '@codevo-whisper/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminCommand } from './support/admin';
import { startFakeSttServer, type FakeSttBehaviour, type FakeSttServer } from './support/fake-stt-server';
import { MessageLog } from './support/message-log';
import { sendInChunks, streamPaced, type ManualClock } from './support/paced-audio';
import { pcmSeconds } from './support/pcm';
import { sendAudio } from './support/send-audio';
import { startHarness, type Harness } from './support/server-harness';
import { peakOf, speech } from './support/speech';
import { createTempDir } from './support/temp-dir';
import { connectSession, type TestSession } from './support/test-client';
import { waitUntil } from './support/wait-until';

const WORDS = ['alfa', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliett', 'kilo', 'lima', 'mike'];

let dir: Awaited<ReturnType<typeof createTempDir>>;
let fake: FakeSttServer | undefined;
let harness: Harness | undefined;
let clock: ManualClock;

function wordResponder(): NonNullable<FakeSttBehaviour['respond']> {
  let calls = 0;
  return () => {
    calls += 1;
    return { status: 200, body: { text: WORDS[(calls - 1) % WORDS.length] } };
  };
}

async function start(behaviour: FakeSttBehaviour = { respond: wordResponder() }): Promise<{ server: Harness; stt: FakeSttServer }> {
  const stt = await startFakeSttServer(behaviour);
  fake = stt;
  const server = await startHarness(dir.path, stt.url, { clock: () => clock.now });
  harness = server;
  return { server, stt };
}

async function readySession(server: Harness, name = 'Test device'): Promise<{ session: TestSession; deviceId: string }> {
  const device = await server.addDevice(name);
  const session = await connectSession(server.url, device, server.serverKey.publicKey);
  expect(await session.next()).toMatchObject({ type: 'ready' });
  const record = (await server.devices.list()).find((candidate) => candidate.name === name);
  return { session, deviceId: record?.id ?? '' };
}

function finalIds(messages: ServerMessage[]): number[] {
  return messages.flatMap((message) => (message.type === 'final' ? [message.segmentId] : []));
}

function expectLiveSequence(messages: ServerMessage[]): void {
  const partials = messages.filter((message) => message.type === 'partial');
  expect(partials.length).toBeGreaterThanOrEqual(2);
  expect(messages.at(-1)?.type).toBe('done');
  expect(finalIds(messages)).toEqual([...finalIds(messages).keys()]);
  const finalized = new Set<number>();
  const lastRevision = new Map<number, number>();
  messages.forEach((message) => {
    if (message.type === 'final') {
      finalized.add(message.segmentId);
    }
    if (message.type !== 'partial') {
      return;
    }
    expect(finalized.has(message.segmentId)).toBe(false);
    expect(message.revision).toBeGreaterThan(lastRevision.get(message.segmentId) ?? 0);
    lastRevision.set(message.segmentId, message.revision);
  });
}

beforeEach(async () => {
  dir = await createTempDir();
  clock = { now: 1_000_000 };
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await fake?.close();
  fake = undefined;
  await dir.remove();
});

describe('live dictation', () => {
  it('commits segments while the user speaks and sends no partials in Indikátor mode', async () => {
    const { server, stt } = await start();
    const { session } = await readySession(server);
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    await streamPaced([session], speech(20), { clock });

    expect(await session.next()).toEqual({ type: 'final', sessionId: 's1', segmentId: 0, text: 'alfa' });
    session.send({ type: 'finish' });
    expect(await session.next()).toEqual({ type: 'final', sessionId: 's1', segmentId: 1, text: 'bravo' });
    expect(await session.next()).toEqual({ type: 'done', sessionId: 's1' });
    expect(stt.requests).toHaveLength(2);
  });

  it('sends rising partial revisions before each final in Živý text mode', async () => {
    const { server, stt } = await start();
    const { session } = await readySession(server);
    const log = new MessageLog(session);
    session.send({ type: 'start', sessionId: 's1', language: 'cs', partials: true });
    await streamPaced([session], speech(20), { clock, yieldMs: 3 });
    session.send({ type: 'finish' });
    await log.waitFor((message) => message.type === 'done');

    expectLiveSequence(log.messages);
    expect(finalIds(log.messages)).toEqual([0, 1]);
    expect(log.messages.every((message) => !('text' in message) || message.text.length > 0)).toBe(true);
    expect(stt.requests.every((request) => request.language === 'cs')).toBe(true);
  });

  it('caps partial text at the protocol limit', async () => {
    const { server } = await start({ respond: () => ({ status: 200, body: { text: 'á'.repeat(20_000) } }) });
    const { session } = await readySession(server);
    session.send({ type: 'start', sessionId: 's1', language: 'sk', partials: true });
    await streamPaced([session], speech(2), { clock, yieldMs: 3 });

    const partial = await session.next();
    expect(partial).toMatchObject({ type: 'partial', segmentId: 0 });
    expect(partial.type === 'partial' ? [...partial.text].length : 0).toBe(MAX_TEXT_CHARS);
  });

  it('cancel aborts only its own call and the shared queue moves on', async () => {
    const { server, stt } = await start({
      delayFor: (pcm) => (peakOf(pcm) > 10_000 ? 5_000 : 0),
      respond: (pcm) => ({ status: 200, body: { text: peakOf(pcm) > 10_000 ? 'hlasno' : 'potichu' } }),
    });
    const first = await readySession(server, 'A');
    const second = await readySession(server, 'B');
    first.session.send({ type: 'start', sessionId: 'a1', language: 'sk' });
    sendAudio(first.session, speech(2, { amplitude: 12_000 }));
    first.session.send({ type: 'finish' });
    await waitUntil(() => stt.requests.length === 1);
    second.session.send({ type: 'start', sessionId: 'b1', language: 'sk' });
    sendAudio(second.session, speech(2));
    second.session.send({ type: 'finish' });
    first.session.send({ type: 'cancel' });

    expect(await first.session.next()).toEqual({ type: 'done', sessionId: 'a1' });
    expect(await second.session.next()).toEqual({ type: 'final', sessionId: 'b1', segmentId: 0, text: 'potichu' });
    expect(await second.session.next()).toEqual({ type: 'done', sessionId: 'b1' });
    await waitUntil(() => stt.aborted() === 1);
    first.session.send({ type: 'start', sessionId: 'a2', language: 'sk' });
    sendAudio(first.session, speech(1));
    first.session.send({ type: 'finish' });
    expect(await first.session.next()).toEqual({ type: 'final', sessionId: 'a2', segmentId: 0, text: 'potichu' });
    expect(await first.session.next()).toEqual({ type: 'done', sessionId: 'a2' });
  });

  it('serves two live devices one call at a time without errors', async () => {
    const { server, stt } = await start({ respond: wordResponder(), delayMs: 10 });
    const first = await readySession(server, 'A');
    const second = await readySession(server, 'B');
    const logs = [new MessageLog(first.session), new MessageLog(second.session)];
    first.session.send({ type: 'start', sessionId: 'a', language: 'sk', partials: true });
    second.session.send({ type: 'start', sessionId: 'b', language: 'sk', partials: true });
    await streamPaced([first.session, second.session], speech(20), { clock, yieldMs: 5 });
    first.session.send({ type: 'finish' });
    second.session.send({ type: 'finish' });
    await Promise.all(logs.map((log) => log.waitFor((message) => message.type === 'done')));

    logs.forEach((log) => {
      expect(log.messages.some((message) => message.type === 'partial')).toBe(true);
      expect(finalIds(log.messages)).toEqual([0, 1]);
      expect(log.messages.filter((message) => message.type === 'error')).toEqual([]);
    });
    expect(stt.maxActive()).toBe(1);
  });

  it('revoke aborts an in-flight partial', async () => {
    const { server, stt } = await start({ delayMs: 5_000 });
    const { session, deviceId } = await readySession(server);
    session.send({ type: 'start', sessionId: 's1', language: 'sk', partials: true });
    await streamPaced([session], speech(1.5), { clock, yieldMs: 3 });
    await waitUntil(() => stt.requests.length === 1);

    expect(await adminCommand(server.config.adminSocket, { cmd: 'revoke', deviceId })).toEqual({ revoked: true, closedSessions: 1 });
    expect(await session.next()).toMatchObject({ type: 'error', code: 'revoked' });
    await waitUntil(() => stt.aborted() === 1);
    expect(server.dispatcher.pendingJobs()).toBe(0);
  });

  it('keeps earlier finals when a later segment fails and reports the error without done', async () => {
    let calls = 0;
    const { server } = await start({
      respond: () => {
        calls += 1;
        return calls === 2 ? { status: 500, body: { error: 'engine' } } : { status: 200, body: { text: 'alfa' } };
      },
    });
    const { session } = await readySession(server);
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, speech(20));
    session.send({ type: 'finish' });

    expect(await session.next()).toEqual({ type: 'final', sessionId: 's1', segmentId: 0, text: 'alfa' });
    expect(await session.next()).toEqual({ type: 'final', sessionId: 's1', segmentId: 1, text: '' });
    expect(await session.next()).toMatchObject({ type: 'error', code: 'stt_unavailable', sessionId: 's1' });
    session.send({ type: 'start', sessionId: 's2', language: 'sk' });
    sendAudio(session, speech(1));
    session.send({ type: 'finish' });
    expect(await session.next()).toEqual({ type: 'final', sessionId: 's2', segmentId: 0, text: 'alfa' });
    expect(await session.next()).toEqual({ type: 'done', sessionId: 's2' });
  });
});

async function nextOfType<T extends ServerMessage['type']>(session: TestSession, type: T): Promise<Extract<ServerMessage, { type: T }>> {
  for (;;) {
    const message = await session.next();
    if (message.type === type) {
      return message as Extract<ServerMessage, { type: T }>;
    }
  }
}

describe('audio ingestion limit', () => {
  it('pauses the flow near the limit and rejects audio beyond it', async () => {
    const { server, stt } = await start();
    const { session } = await readySession(server);
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, pcmSeconds(151));

    expect(await nextOfType(session, 'flow')).toEqual({ type: 'flow', paused: true });
    sendAudio(session, pcmSeconds(30));
    expect(await nextOfType(session, 'error')).toMatchObject({ code: 'bad_message', message: 'audio rate exceeded' });
    expect((await session.closed).code).toBe(4000);
    expect(stt.requests).toHaveLength(0);
  });

  it('resumes the flow once the bucket has refilled', async () => {
    const { server } = await start();
    const { session } = await readySession(server);
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, pcmSeconds(151));
    expect(await nextOfType(session, 'flow')).toEqual({ type: 'flow', paused: true });
    clock.now += 30_000;

    expect(await nextOfType(session, 'flow')).toEqual({ type: 'flow', paused: false });
  });

  it('accepts a 2-minute retry burst followed by real-time audio', async () => {
    const { server } = await start();
    const { session } = await readySession(server);
    const log = new MessageLog(session);
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, pcmSeconds(120));
    await sendInChunks(session, pcmSeconds(120), { clock, frameMs: 1_000 });
    session.send({ type: 'finish' });
    await log.waitFor((message) => message.type === 'done' || message.type === 'error');

    expect(log.messages.filter((message) => message.type === 'flow' || message.type === 'error')).toEqual([]);
    expect(log.messages.at(-1)).toEqual({ type: 'done', sessionId: 's1' });
  });

  it('shares the limit between the sessions of one device', async () => {
    const { server } = await start();
    const device = await server.addDevice();
    const first = await connectSession(server.url, device, server.serverKey.publicKey);
    const second = await connectSession(server.url, device, server.serverKey.publicKey);
    expect(await first.next()).toMatchObject({ type: 'ready' });
    expect(await second.next()).toMatchObject({ type: 'ready' });
    first.send({ type: 'start', sessionId: 'a', language: 'sk' });
    sendAudio(first, pcmSeconds(120));
    expect(await nextOfType(first, 'final')).toMatchObject({ segmentId: 0 });
    await waitUntil(() => server.gateway.sessions.count() === 2);
    second.send({ type: 'start', sessionId: 'b', language: 'sk' });
    sendAudio(second, pcmSeconds(70));

    expect(await nextOfType(second, 'error')).toMatchObject({ code: 'bad_message', message: 'audio rate exceeded' });
  });
});
