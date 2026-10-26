import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { beginSession, closeCodeFor, generateKeyPair, type KeyPair } from '@codevo-whisper/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { SecureConnection } from '../src/main/remote/secure-connection';
import { acceptSession, startResponder, type ScriptedResponder } from './support/scripted-responder';

const OPTIONS = { handshakeTimeoutMs: 2000 };

let responder: ScriptedResponder | undefined;
let tcp: Server | undefined;

afterEach(async () => {
  await responder?.close();
  responder = undefined;
  await new Promise<void>((resolve) => {
    if (tcp === undefined) {
      resolve();
      return;
    }
    tcp.close(() => resolve());
  });
  tcp = undefined;
});

function session(serverKey: KeyPair) {
  return beginSession(generateKeyPair(), serverKey.publicKey);
}

async function closedPort(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `ws://127.0.0.1:${port}`;
}

describe('SecureConnection', () => {
  it('reports offline for an endpoint nobody listens on', async () => {
    await expect(SecureConnection.open(await closedPort(), session(generateKeyPair()), OPTIONS)).rejects.toMatchObject({ kind: 'offline' });
  });

  it('gives up with a timeout when the server never answers the handshake and terminates the socket', async () => {
    responder = await startResponder(() => undefined);

    await expect(SecureConnection.open(responder.url, session(responder.serverKey), { handshakeTimeoutMs: 150 })).rejects.toMatchObject({ kind: 'timeout' });
    await responder.closed;
  });

  it('treats an unauthenticated handshake reply as a changed server key', async () => {
    responder = await startResponder((socket) => socket.send(new Uint8Array(48)));

    await expect(SecureConnection.open(responder.url, session(responder.serverKey), OPTIONS)).rejects.toMatchObject({ kind: 'server-key-changed' });
    await responder.closed;
  });

  it('maps a rejection before the reply to the error code', async () => {
    responder = await startResponder((socket) => socket.close(closeCodeFor('unknown_device'), 'unknown_device'));

    await expect(SecureConnection.open(responder.url, session(responder.serverKey), OPTIONS)).rejects.toMatchObject({ kind: 'device-unknown' });
  });

  it('treats a handshake the server could not read as a changed server key', async () => {
    responder = await startResponder((socket) => socket.close(closeCodeFor('bad_message'), 'bad_message'));

    await expect(SecureConnection.open(responder.url, session(responder.serverKey), OPTIONS)).rejects.toMatchObject({ kind: 'server-key-changed' });
  });

  it('exchanges messages in both directions across rekeys', async () => {
    const sessions: Array<ReturnType<typeof acceptSession>> = [];
    const serverKey = generateKeyPair();
    responder = await startResponder((socket, opening) => {
      const accepted = acceptSession(socket, opening, serverKey, 3);
      sessions.push(accepted);
      for (let index = 0; index < 10; index += 1) {
        accepted.send({ type: 'done', sessionId: `s${index}` });
      }
    });
    const connection = await SecureConnection.open(responder.url, beginSession(generateKeyPair(), serverKey.publicKey), { ...OPTIONS, rekeyEvery: 3 });

    const received: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const message = await connection.next(1000);
      received.push(message.type === 'done' ? message.sessionId : message.type);
    }
    for (let index = 0; index < 10; index += 1) {
      connection.send({ type: 'hello' });
    }

    expect(received).toEqual(['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']);
    await expect.poll(() => sessions[0]?.received.length).toBe(10);
    expect(connection.handshakeHash).toHaveLength(32);
    connection.close();
  });

  it('closes with a protocol failure when the server sends a text frame', async () => {
    const serverKey = generateKeyPair();
    responder = await startResponder((socket, opening) => {
      acceptSession(socket, opening, serverKey);
      setTimeout(() => socket.send('plain text'), 20);
    });
    const connection = await SecureConnection.open(responder.url, beginSession(generateKeyPair(), serverKey.publicKey), OPTIONS);

    const failure = await new Promise((resolve) => connection.onClose(resolve));

    expect(failure).toMatchObject({ kind: 'protocol' });
    await responder.closed;
  });

  it('reports the close code after the handshake', async () => {
    const serverKey = generateKeyPair();
    responder = await startResponder((socket, opening) => {
      acceptSession(socket, opening, serverKey);
      setTimeout(() => socket.close(closeCodeFor('revoked'), 'revoked'), 20);
    });
    const connection = await SecureConnection.open(responder.url, beginSession(generateKeyPair(), serverKey.publicKey), OPTIONS);

    expect(await new Promise((resolve) => connection.onClose(resolve))).toMatchObject({ kind: 'device-unknown' });
  });

  it('notices a peer that stopped answering pings', async () => {
    const serverKey = generateKeyPair();
    responder = await startResponder((socket, opening) => acceptSession(socket, opening, serverKey), { autoPong: false });
    const connection = await SecureConnection.open(responder.url, beginSession(generateKeyPair(), serverKey.publicKey), { ...OPTIONS, keepAliveMs: 50 });
    const startedAt = Date.now();

    expect(await new Promise((resolve) => connection.onClose(resolve))).toMatchObject({ kind: 'connection-lost' });
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('does not report its own close', async () => {
    const serverKey = generateKeyPair();
    responder = await startResponder((socket, opening) => acceptSession(socket, opening, serverKey));
    const connection = await SecureConnection.open(responder.url, beginSession(generateKeyPair(), serverKey.publicKey), OPTIONS);
    const failures: unknown[] = [];
    connection.onClose((failure) => failures.push(failure));

    connection.close();
    await responder.closed;

    expect(failures).toEqual([]);
    await expect(connection.next(100)).rejects.toMatchObject({ kind: 'connection-lost' });
  });

  it('reports a close that happened before the listener was registered', async () => {
    const serverKey = generateKeyPair();
    responder = await startResponder((socket, opening) => {
      acceptSession(socket, opening, serverKey);
      setTimeout(() => socket.close(closeCodeFor('revoked'), 'revoked'), 20);
    });
    const connection = await SecureConnection.open(responder.url, beginSession(generateKeyPair(), serverKey.publicKey), OPTIONS);
    await expect(connection.next(1000)).rejects.toMatchObject({ kind: 'device-unknown' });

    expect(await new Promise((resolve) => connection.onClose(resolve))).toMatchObject({ kind: 'device-unknown' });
  });
});
