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
  plaintexts: Uint8Array[];
  onMessage(listener: (message: ClientMessage) => void): void;
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

function decodeLenient(plaintext: Uint8Array): ClientMessage {
  if (plaintext[0] !== 0x01) {
    return decodeClientMessage(plaintext);
  }
  const object = JSON.parse(new TextDecoder().decode(plaintext.subarray(1))) as Record<string, unknown>;
  if (object.type !== 'start') {
    return decodeClientMessage(plaintext);
  }
  return { type: 'start', sessionId: String(object.sessionId), language: 'sk' };
}

export function acceptSession(socket: WebSocket, opening: Uint8Array, serverKey: KeyPair, rekeyEvery?: number): ResponderSession {
  const responder = createHandshake({ pattern: 'IK', initiator: false, prologue: PROLOGUE_SESSION, staticKey: serverKey });
  responder.readMessage(decodeOpeningFrame(opening).noiseMessage);
  socket.send(responder.writeMessage(new Uint8Array(0)));
  const transport = new SecureTransport(responder.result(), rekeyEvery);
  const received: ClientMessage[] = [];
  const plaintexts: Uint8Array[] = [];
  const listeners: Array<(message: ClientMessage) => void> = [];
  socket.on('message', (data: Buffer) => {
    const plaintext = transport.open(new Uint8Array(data));
    plaintexts.push(plaintext);
    const message = decodeLenient(plaintext);
    received.push(message);
    listeners.forEach((listener) => listener(message));
  });
  return {
    socket,
    received,
    plaintexts,
    send: (message) => socket.send(transport.seal(encodeServerMessage(message))),
    onMessage: (listener) => listeners.push(listener),
  };
}
