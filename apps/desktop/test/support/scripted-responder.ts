import type { AddressInfo } from 'node:net';
import {
  createHandshake,
  decodeClientMessage,
  decodeOpeningFrame,
  encodeServerMessage,
  generateKeyPair,
  PROLOGUE_SESSION,
  SecureTransport,
  type ClientMessage,
  type KeyPair,
  type ServerMessage,
} from '@codevo-whisper/protocol';
import { WebSocketServer, type WebSocket } from 'ws';

export type ResponderSession = {
  socket: WebSocket;
  send(message: ServerMessage): void;
  received: ClientMessage[];
};

export type ScriptedResponder = {
  url: string;
  serverKey: KeyPair;
  closed: Promise<void>;
  close(): Promise<void>;
};

export type ResponderOptions = { autoPong?: boolean; rekeyEvery?: number };

export async function startResponder(onOpening: (socket: WebSocket, opening: Uint8Array) => void, options: ResponderOptions = {}): Promise<ScriptedResponder> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1', autoPong: options.autoPong ?? true });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const closed = new Promise<void>((resolve) => {
    server.on('connection', (socket) => {
      socket.on('error', () => undefined);
      socket.once('close', () => resolve());
      socket.once('message', (data: Buffer) => onOpening(socket, new Uint8Array(data)));
    });
  });
  return {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    serverKey: generateKeyPair(),
    closed,
    close: () =>
      new Promise<void>((resolve) => {
        server.clients.forEach((client) => client.terminate());
        server.close(() => resolve());
      }),
  };
}

export function acceptSession(socket: WebSocket, opening: Uint8Array, serverKey: KeyPair, rekeyEvery?: number): ResponderSession {
  const responder = createHandshake({ pattern: 'IK', initiator: false, prologue: PROLOGUE_SESSION, staticKey: serverKey });
  responder.readMessage(decodeOpeningFrame(opening).noiseMessage);
  socket.send(responder.writeMessage(new Uint8Array(0)));
  const transport = new SecureTransport(responder.result(), rekeyEvery);
  const received: ClientMessage[] = [];
  socket.on('message', (data: Buffer) => received.push(decodeClientMessage(transport.open(new Uint8Array(data)))));
  return { socket, received, send: (message) => socket.send(transport.seal(encodeServerMessage(message))) };
}
