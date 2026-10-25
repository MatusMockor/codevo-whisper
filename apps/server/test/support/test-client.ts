import {
  beginPairing,
  beginSession,
  fingerprint,
  type PairingToken,
  decodeServerMessage,
  encodeClientMessage,
  type ClientHandshake,
  type ClientMessage,
  type KeyPair,
  type SecureTransport,
  type ServerMessage,
} from '@codevo-whisper/protocol';
import { expect } from 'vitest';
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

export async function openSocket(url: string, headers: Record<string, string> = {}): Promise<{ socket: WebSocket; inbox: Inbox }> {
  const socket = new WebSocket(url, { perMessageDeflate: false, generateMask: zeroMask, headers });
  const inbox = new Inbox(socket);
  socket.on('error', () => undefined);
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
  const reply = await inbox.next();
  const completion = new Promise<ReturnType<ClientHandshake['complete']>>((resolve) => resolve(handshake.complete(reply)));
  completion.catch(() => socket.close());
  const { transport, handshake: result } = await completion;
  return sessionOver(socket, inbox, transport, result.handshakeHash);
}

export async function connectSession(url: string, device: KeyPair, serverPublicKey: Uint8Array): Promise<TestSession> {
  const session = await runHandshake(url, beginSession(device, serverPublicKey));
  session.send({ type: 'hello' });
  return session;
}

export type PairingOutcome = { status: 'approved' | 'rejected'; deviceId?: string; handshakeFingerprint: string };

function isPairResult(message: ServerMessage): message is Extract<ServerMessage, { type: 'pair-result' }> {
  return message.type === 'pair-result';
}

export async function pairDevice(url: string, token: PairingToken, device: KeyPair, deviceName: string): Promise<PairingOutcome> {
  const session = await runHandshake(url, beginPairing(device, token));
  session.send({ type: 'pair-request', deviceName });
  const result = await session.next();
  session.close();
  const handshakeFingerprint = fingerprint(session.handshakeHash);
  expect(result).toMatchObject({ type: 'pair-result' });
  if (!isPairResult(result) || result.deviceId === undefined) {
    return { status: 'rejected', handshakeFingerprint };
  }
  return { status: result.status, deviceId: result.deviceId, handshakeFingerprint };
}
