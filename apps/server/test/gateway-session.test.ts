import { beginSession, generateKeyPair, type ServerMessage } from '@codevo-whisper/protocol';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connect, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { streamLogger } from '../src/logging/logger';
import { startFakeSttServer, type FakeSttServer } from './support/fake-stt-server';
import { pcmSeconds } from './support/pcm';
import { sendAudio } from './support/send-audio';
import { startHarness, type Harness } from './support/server-harness';
import { createTempDir } from './support/temp-dir';
import { connectSession, openSocket, runHandshake, type TestSession } from './support/test-client';
import { waitUntil } from './support/wait-until';

let dir: Awaited<ReturnType<typeof createTempDir>>;
let fake: FakeSttServer;
let harness: Harness | undefined;

beforeEach(async () => {
  dir = await createTempDir();
  fake = await startFakeSttServer({ respond: () => ({ status: 200, body: { text: 'ahoj svet' } }) });
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await fake.close();
  await dir.remove();
});

async function start(options: Parameters<typeof startHarness>[2] = {}): Promise<Harness> {
  harness = await startHarness(dir.path, fake.url, options);
  return harness;
}

async function readySession(server: Harness): Promise<TestSession> {
  const device = await server.addDevice();
  const session = await connectSession(server.url, device, server.serverKey.publicKey);
  expect(await session.next()).toEqual({ type: 'ready', serverVersion: expect.any(String) as string });
  return session;
}

async function expectBadMessageClose(session: TestSession): Promise<void> {
  expect(await session.next()).toMatchObject({ type: 'error', code: 'bad_message' });
  expect((await session.closed).code).toBe(4000);
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

describe('gateway sessions', () => {
  it('transcribes a session end to end', async () => {
    const server = await start();
    const session = await readySession(server);
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, pcmSeconds(2));
    session.send({ type: 'finish' });

    expect(await collectUntilDone(session)).toEqual([
      { type: 'final', sessionId: 's1', segmentId: 0, text: 'ahoj svet' },
      { type: 'done', sessionId: 's1' },
    ]);
    expect(fake.requests).toEqual([{ language: 'sk', bytes: 64_000 }]);
    expect((await server.devices.list())[0]?.lastSeenAt).not.toBeNull();
  });

  it('splits long audio into 25 s chunks', async () => {
    const server = await start();
    const session = await readySession(server);
    session.send({ type: 'start', sessionId: 's1', language: 'en' });
    sendAudio(session, pcmSeconds(60));
    session.send({ type: 'finish' });

    const messages = await collectUntilDone(session);
    expect(messages.map((message) => (message.type === 'final' ? message.segmentId : message.type))).toEqual([0, 1, 2, 'done']);
    expect(fake.requests.map((request) => request.bytes)).toEqual([800_000, 800_000, 320_000]);
  });

  it('accepts a new dictation after done', async () => {
    const server = await start();
    const session = await readySession(server);
    for (const id of ['a', 'b']) {
      session.send({ type: 'start', sessionId: id, language: 'sk' });
      sendAudio(session, pcmSeconds(1));
      session.send({ type: 'finish' });
      expect((await collectUntilDone(session)).at(-1)).toEqual({ type: 'done', sessionId: id });
    }
    expect(fake.requests).toHaveLength(2);
  });

  it('rejects an unknown device before ready', async () => {
    const server = await start();

    await expect(connectSession(server.url, generateKeyPair(), server.serverKey.publicKey)).rejects.toMatchObject({
      code: 'unknown_device',
    });
    expect(fake.requests).toHaveLength(0);
  });

  it('refuses messages sent before ready', async () => {
    let reached: () => void = () => undefined;
    let release: () => void = () => undefined;
    const gateReached = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = await start({
      beforeReady: () => {
        reached();
        return gate;
      },
    });
    const device = await server.addDevice();
    const session = await connectSession(server.url, device, server.serverKey.publicKey);
    await gateReached;
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, pcmSeconds(1));
    session.send({ type: 'finish' });

    expect(await session.next()).toMatchObject({ type: 'error', code: 'bad_message' });
    release();
    expect((await session.closed).code).toBe(4000);
    await expect(session.next()).rejects.toBeInstanceOf(Error);
    expect(fake.requests).toHaveLength(0);
  });

  it('has no side effects when a captured opening frame is replayed', async () => {
    let now = 1_000_000;
    const server = await start({ clock: () => now, handshakeTimeoutMs: 200 });
    const device = await server.addDevice();
    const handshake = beginSession(device, server.serverKey.publicKey);
    const original = await runHandshake(server.url, handshake);
    original.send({ type: 'hello' });
    expect(await original.next()).toMatchObject({ type: 'ready' });
    original.close();
    await original.closed;
    await waitUntil(() => server.gateway.sessions.count() === 0 && server.gateway.limiter.pending() === 0);
    const seenAt = (await server.devices.list())[0]?.lastSeenAt;
    now += 60_000;

    const replay = await openSocket(server.url);
    replay.socket.send(handshake.openingFrame);
    const reply = await replay.inbox.next();
    expect(reply.length).toBeGreaterThan(0);
    expect(server.gateway.sessions.count()).toBe(0);
    expect(server.gateway.limiter.pending()).toBe(1);

    expect((await replay.inbox.closed).code).toBe(1008);
    await expect(replay.inbox.next()).rejects.toBeInstanceOf(Error);
    await waitUntil(() => server.gateway.limiter.pending() === 0);
    expect(server.gateway.sessions.count()).toBe(0);
    expect((await server.devices.list())[0]?.lastSeenAt).toBe(seenAt);
  });

  it('closes the connection instead of crashing when the device registry cannot be read', async () => {
    const server = await start();
    const device = await server.addDevice();
    const connecting = await runHandshake(server.url, beginSession(device, server.serverKey.publicKey));
    await writeFile(join(dir.path, 'devices.json'), '{ not json', { mode: 0o600 });
    connecting.send({ type: 'hello' });

    expect((await connecting.closed).code).toBe(1011);
    await waitUntil(() => server.gateway.sessions.count() === 0);
    await expect(connectSession(server.url, device, server.serverKey.publicKey)).rejects.toThrow(/1011/);
  });

  it('requires hello as the first transport message', async () => {
    const server = await start();
    const device = await server.addDevice();
    const session = await runHandshake(server.url, beginSession(device, server.serverKey.publicKey));
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });

    expect(await session.next()).toMatchObject({ type: 'error', code: 'bad_message' });
    expect((await session.closed).code).toBe(4000);
    expect(server.gateway.sessions.count()).toBe(0);
    expect((await server.devices.list())[0]?.lastSeenAt).toBeNull();
  });

  it('rejects a client that expects another server key', async () => {
    const server = await start();
    const device = await server.addDevice();

    await expect(connectSession(server.url, device, generateKeyPair().publicKey)).rejects.toMatchObject({ code: 'bad_message' });
  });

  it('rejects out-of-order messages', async () => {
    const server = await start();
    const audioFirst = await readySession(server);
    audioFirst.send({ type: 'audio', pcm: pcmSeconds(1) });
    await expectBadMessageClose(audioFirst);

    const twoStarts = await readySession(server);
    twoStarts.send({ type: 'start', sessionId: 's1', language: 'sk' });
    twoStarts.send({ type: 'start', sessionId: 's2', language: 'sk' });
    await expectBadMessageClose(twoStarts);

    const audioAfterFinish = await readySession(server);
    audioAfterFinish.send({ type: 'start', sessionId: 's1', language: 'sk' });
    audioAfterFinish.send({ type: 'finish' });
    expect(await audioAfterFinish.next()).toEqual({ type: 'done', sessionId: 's1' });
    audioAfterFinish.send({ type: 'audio', pcm: pcmSeconds(1) });
    await expectBadMessageClose(audioAfterFinish);


    const pairInSession = await readySession(server);
    pairInSession.send({ type: 'pair-request', deviceName: 'x' });
    await expectBadMessageClose(pairInSession);

    expect(fake.requests).toHaveLength(0);
  });

  it('rejects audio while finishing', async () => {
    await fake.close();
    fake = await startFakeSttServer({ delayMs: 200 });
    const server = await start();
    const session = await readySession(server);
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, pcmSeconds(1));
    session.send({ type: 'finish' });
    session.send({ type: 'audio', pcm: pcmSeconds(1) });

    await expectBadMessageClose(session);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fake.aborted()).toBe(fake.requests.length);
  });

  it('reports stt_unavailable', async () => {
    await fake.close();
    fake = await startFakeSttServer({ respond: () => ({ status: 500, body: { error: 'engine' } }) });
    const server = await start();
    const session = await readySession(server);
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, pcmSeconds(1));
    session.send({ type: 'finish' });

    expect(await session.next()).toMatchObject({ type: 'error', code: 'stt_unavailable', sessionId: 's1' });
  });

  it('cancel drops buffered audio', async () => {
    const server = await start();
    const session = await readySession(server);
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, pcmSeconds(3));
    session.send({ type: 'cancel' });
    session.send({ type: 'finish' });

    expect(await session.next()).toEqual({ type: 'done', sessionId: 's1' });
    await expectBadMessageClose(session);
    expect(fake.requests).toHaveLength(0);
  });

  it('acknowledges a cancel during finishing and never mixes its results into the next dictation', async () => {
    await fake.close();
    fake = await startFakeSttServer({ delayMs: 100, respond: (_pcm, language) => ({ status: 200, body: { text: `text-${language}` } }) });
    const server = await start();
    const session = await readySession(server);
    session.send({ type: 'start', sessionId: 'first', language: 'sk' });
    sendAudio(session, pcmSeconds(1));
    session.send({ type: 'finish' });
    await waitUntil(() => fake.requests.length === 1);
    session.send({ type: 'cancel' });
    session.send({ type: 'start', sessionId: 'second', language: 'en' });
    sendAudio(session, pcmSeconds(1));
    session.send({ type: 'finish' });

    expect(await session.next()).toEqual({ type: 'done', sessionId: 'first' });
    expect(await collectUntilDone(session)).toEqual([
      { type: 'final', sessionId: 'second', segmentId: 0, text: 'text-en' },
      { type: 'done', sessionId: 'second' },
    ]);
  });

  it('reconnects after gateway restart', async () => {
    const first = await start();
    const device = await first.addDevice();
    const serverKey = first.serverKey.publicKey;
    const session = await connectSession(first.url, device, serverKey);
    expect(await session.next()).toMatchObject({ type: 'ready' });
    await first.close();
    harness = undefined;
    await session.closed;

    const second = await start();
    expect(second.serverKey.publicKey).toEqual(serverKey);
    const again = await connectSession(second.url, device, serverKey);
    expect(await again.next()).toMatchObject({ type: 'ready' });
  });

  it('closes a session after the maximum duration', async () => {
    let now = 1_000_000;
    const server = await start({ clock: () => now });
    const session = await readySession(server);
    now += 600_001;
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });

    expect(await session.next()).toMatchObject({ type: 'error', code: 'session_expired' });
    expect((await session.closed).code).toBe(4005);
  });

  it('lets a dictation started near the session limit complete', async () => {
    let now = 1_000_000;
    await fake.close();
    fake = await startFakeSttServer({
      respond: () => {
        now += 600_001;
        return { status: 200, body: { text: 'ahoj svet' } };
      },
    });
    const server = await start({ clock: () => now });
    const session = await readySession(server);
    session.send({ type: 'start', sessionId: 'late', language: 'sk' });
    sendAudio(session, pcmSeconds(1));
    session.send({ type: 'finish' });

    expect(await collectUntilDone(session)).toEqual([
      { type: 'final', sessionId: 'late', segmentId: 0, text: 'ahoj svet' },
      { type: 'done', sessionId: 'late' },
    ]);
    expect(await session.next()).toMatchObject({ type: 'error', code: 'session_expired' });
  });

  it('closes even a busy session at the hard limit', async () => {
    let now = 1_000_000;
    const server = await start({ clock: () => now });
    const session = await readySession(server);
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, pcmSeconds(301));
    expect(await session.next()).toEqual({ type: 'flow', paused: true });
    now += 1_800_001;
    sendAudio(session, pcmSeconds(1));

    expect(await session.next()).toMatchObject({ type: 'error', code: 'session_expired' });
    expect(fake.requests).toHaveLength(0);
  });

  it('rejects audio frames shorter than 20 ms unless they are the last one', async () => {
    const server = await start();
    const last = await readySession(server);
    last.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(last, pcmSeconds(1));
    last.send({ type: 'audio', pcm: new Uint8Array(100) });
    last.send({ type: 'finish' });
    expect((await collectUntilDone(last)).at(-1)).toEqual({ type: 'done', sessionId: 's1' });

    const tiny = await readySession(server);
    tiny.send({ type: 'start', sessionId: 's2', language: 'sk' });
    for (let index = 0; index < 10_000; index += 1) {
      tiny.send({ type: 'audio', pcm: new Uint8Array(2) });
    }
    await expectBadMessageClose(tiny);
    expect(fake.requests).toHaveLength(1);
  });

  it('limits the message rate per connection', async () => {
    const now = 1_000_000;
    const server = await start({ clock: () => now });
    const session = await readySession(server);
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    for (let index = 0; index < 1_001; index += 1) {
      session.send({ type: 'audio', pcm: new Uint8Array(640) });
    }

    await expectBadMessageClose(session);
    expect(fake.requests).toHaveLength(0);
  });

  it('caps the audio one device can buffer across its sessions', async () => {
    const server = await start();
    const device = await server.addDevice();
    const first = await connectSession(server.url, device, server.serverKey.publicKey);
    const second = await connectSession(server.url, device, server.serverKey.publicKey);
    expect(await first.next()).toMatchObject({ type: 'ready' });
    expect(await second.next()).toMatchObject({ type: 'ready' });
    first.send({ type: 'start', sessionId: 'a', language: 'sk' });
    sendAudio(first, pcmSeconds(301));
    expect(await first.next()).toEqual({ type: 'flow', paused: true });
    second.send({ type: 'start', sessionId: 'b', language: 'sk' });
    sendAudio(second, pcmSeconds(300));

    expect(await second.next()).toMatchObject({ type: 'error', code: 'too_long' });
  });

  it('rejects a text frame and an oversized frame', async () => {
    const server = await start();
    const text = await openSocket(server.url);
    text.socket.send('ahoj');
    expect((await text.inbox.closed).code).toBe(1003);

    const oversized = await openSocket(server.url);
    oversized.socket.send(new Uint8Array(65_537));
    expect((await oversized.inbox.closed).code).toBe(1009);
  });

  it('rejects a garbage opening frame', async () => {
    const server = await start();
    const garbage = await openSocket(server.url);
    garbage.socket.send(new Uint8Array([0x02, 1, 2, 3]));

    expect((await garbage.inbox.closed).code).toBe(4000);
  });

  it('signals flow pause when buffered audio exceeds 300 s', async () => {
    const server = await start();
    const session = await readySession(server);
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, pcmSeconds(301));

    expect(await session.next()).toEqual({ type: 'flow', paused: true });
    session.send({ type: 'cancel' });
    expect(await session.next()).toEqual({ type: 'done', sessionId: 's1' });
    expect(await session.next()).toEqual({ type: 'flow', paused: false });
  });

  it('rejects more than 600 s of audio with too_long', async () => {
    const server = await start();
    const session = await readySession(server);
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, pcmSeconds(601));

    expect(await session.next()).toEqual({ type: 'flow', paused: true });
    expect(await session.next()).toMatchObject({ type: 'error', code: 'too_long' });
    expect(fake.requests).toHaveLength(0);
  });

  it('closes a connection that does not finish the handshake in time', async () => {
    const server = await start({ handshakeTimeoutMs: 100 });
    const idle = await openSocket(server.url);
    await waitUntil(() => server.gateway.limiter.pending() === 1);

    expect((await idle.inbox.closed).code).toBe(1008);
    await waitUntil(() => server.gateway.limiter.pending() === 0);
  });

  it('closes sessions when the gateway closes', async () => {
    const server = await start();
    const session = await readySession(server);
    expect(server.gateway.sessions.count()).toBe(1);
    await server.close();
    harness = undefined;

    expect((await session.closed).code).toBe(1001);
  });

  it('limits concurrent connections per IP', async () => {
    const server = await start();
    const sockets = await Promise.all(Array.from({ length: 4 }, () => openSocket(server.url)));

    await expect(openSocket(server.url)).rejects.toBeInstanceOf(Error);
    sockets.forEach(({ socket }) => socket.close());
  });

  it('counts raw TCP connections before the upgrade and drops them at the deadline', async () => {
    const server = await start({ handshakeTimeoutMs: 200 });
    const raw = await Promise.all(
      Array.from({ length: 4 }, () => new Promise<Socket>((resolve) => {
        const socket = connect(server.gateway.port, '127.0.0.1', () => resolve(socket));
        socket.on('error', () => undefined);
      })),
    );
    await waitUntil(() => server.gateway.limiter.pending() === 4);

    await expect(openSocket(server.url)).rejects.toBeInstanceOf(Error);
    await Promise.all(raw.map((socket) => new Promise((resolve) => socket.once('close', resolve))));
    await waitUntil(() => server.gateway.limiter.pending() === 0);
  });

  it('rejects fragmented WebSocket messages', async () => {
    const server = await start();
    const fragmented = await openSocket(server.url);
    fragmented.socket.send(new Uint8Array([0x02, 1, 2]), { fin: false });
    fragmented.socket.send(new Uint8Array([3, 4]), { fin: true });

    expect((await fragmented.inbox.closed).code).toBe(1008);
  });

  it('ignores messages that arrive after the server closed the session', async () => {
    const lines: string[] = [];
    const server = await start({ logger: streamLogger((line) => lines.push(line)) });
    const session = await readySession(server);
    const [device] = await server.devices.list();
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, pcmSeconds(1));
    await waitUntil(() => server.gateway.sessions.count() === 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    server.gateway.sessions.closeDevice(device?.id ?? '', 'revoked');
    session.send({ type: 'finish' });

    expect(await session.next()).toMatchObject({ type: 'error', code: 'revoked' });
    await session.closed;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lines.filter((line) => line.includes('"dictation"'))).toEqual([]);
    expect(fake.requests).toHaveLength(0);
  });
});
