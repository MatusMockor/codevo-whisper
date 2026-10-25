import {
  beginSession,
  decodeServerMessage,
  encodeClientMessage,
  type ClientHandshake,
  type ClientMessage,
  type KeyPair,
  type SecureTransport,
  type ServerMessage,
} from '@codevo-whisper/protocol';
import WebSocket from 'ws';
import { Inbox, type CloseInfo } from './inbox';

export type TestSession = {
  send(message: ClientMessage): void;
  next(): Promise<ServerMessage>;
  close(): void;
  closed: Promise<CloseInfo>;
  handshakeHash: Uint8Array;
};

const zeroMask = (mask: Buffer): void => {
  mask.fill(0);
};

export async function openSocket(url: string): Promise<{ socket: WebSocket; inbox: Inbox }> {
  const socket = new WebSocket(url, { perMessageDeflate: false, generateMask: zeroMask });
  const inbox = new Inbox(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return { socket, inbox };
}

export function sessionOver(socket: WebSocket, inbox: Inbox, transport: SecureTransport, handshakeHash: Uint8Array): TestSession {
  return {
    send: (message) => socket.send(transport.seal(encodeClientMessage(message))),
    next: async () => decodeServerMessage(transport.open(await inbox.next())),
    close: () => socket.close(),
    closed: inbox.closed,
    handshakeHash,
  };
}

export async function runHandshake(url: string, handshake: ClientHandshake): Promise<TestSession> {
  const { socket, inbox } = await openSocket(url);
  socket.send(handshake.openingFrame);
  const { transport, handshake: result } = handshake.complete(await inbox.next());
  return sessionOver(socket, inbox, transport, result.handshakeHash);
}

export function connectSession(url: string, device: KeyPair, serverPublicKey: Uint8Array): Promise<TestSession> {
  return runHandshake(url, beginSession(device, serverPublicKey));
}
