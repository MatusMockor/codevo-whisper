import type { AddressInfo } from 'node:net';
import {
  beginSession,
  createHandshake,
  decodeOpeningFrame,
  encodeServerMessage,
  generateKeyPair,
  PROLOGUE_SESSION,
  SecureTransport,
} from '@codevo-whisper/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { SecureSocket } from '../src/secure-socket';

let server: WebSocketServer | undefined;

async function peer(onConnection: (socket: WebSocket) => void): Promise<{ url: string; closed: Promise<void> }> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  server = wss;
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const closed = new Promise<void>((resolve) => {
    wss.on('connection', (socket) => {
      socket.once('close', () => resolve());
      onConnection(socket);
    });
  });
  return { url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`, closed };
}

function handshake(): ReturnType<typeof beginSession> {
  return beginSession(generateKeyPair(), generateKeyPair().publicKey);
}

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server?.clients.forEach((client) => client.terminate());
    server?.close(() => resolve());
  });
  server = undefined;
});

describe('SecureSocket', () => {
  it('gives up when the server does not answer the handshake in time', async () => {
    const { url, closed } = await peer(() => undefined);

    await expect(SecureSocket.connect(url, handshake(), { handshakeTimeoutMs: 100 })).rejects.toThrow(/timed out/);
    await closed;
  });

  it('terminates the socket when the handshake reply is invalid', async () => {
    const { url, closed } = await peer((socket) => socket.once('message', () => socket.send(new Uint8Array(48))));

    await expect(SecureSocket.connect(url, handshake())).rejects.toMatchObject({ code: 'bad_message' });
    await closed;
  });

  it('drops the connection when unread messages pile up', async () => {
    const serverKey = generateKeyPair();
    const { url, closed } = await peer((socket) => {
      socket.once('message', (data: Buffer) => {
        const responder = createHandshake({ pattern: 'IK', initiator: false, prologue: PROLOGUE_SESSION, staticKey: serverKey });
        responder.readMessage(decodeOpeningFrame(new Uint8Array(data)).noiseMessage);
        socket.send(responder.writeMessage(new Uint8Array(0)));
        const transport = new SecureTransport(responder.result());
        for (let index = 0; index < 50; index += 1) {
          socket.send(transport.seal(encodeServerMessage({ type: 'flow', paused: false })));
        }
      });
    });
    const client = await SecureSocket.connect(url, beginSession(generateKeyPair(), serverKey.publicKey), { maxQueuedMessages: 10 });

    await closed;
    await expect(client.next()).rejects.toThrow(/unread/);
  });
});
