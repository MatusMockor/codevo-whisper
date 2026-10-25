import { parsePairingToken, type PairingToken } from '@codevo-whisper/protocol';
import { expect } from 'vitest';
import { connectAdmin, type AdminConnection } from '../../src/admin/admin-client';

export type OpenedWindow = { admin: AdminConnection; token: PairingToken; text: string; expiresAt: number };

type TokenEvent = { event: 'token'; token: string; expiresAt: number };

function isTokenEvent(value: unknown): value is TokenEvent {
  return typeof value === 'object' && value !== null && (value as { event?: unknown }).event === 'token';
}

export async function openPairingWindow(socketPath: string, ttlMs?: number): Promise<OpenedWindow> {
  const admin = await connectAdmin(socketPath);
  admin.send(ttlMs === undefined ? { cmd: 'pair' } : { cmd: 'pair', ttlMs });
  const event = await admin.next();
  expect(event).toMatchObject({ event: 'token', token: expect.any(String) as string, expiresAt: expect.any(Number) as number });
  const tokenEvent = isTokenEvent(event) ? event : { event: 'token', token: '', expiresAt: 0 };
  return { admin, token: parsePairingToken(tokenEvent.token), text: tokenEvent.token, expiresAt: tokenEvent.expiresAt };
}

export async function adminCommand(socketPath: string, command: object): Promise<unknown> {
  const admin = await connectAdmin(socketPath);
  admin.send(command);
  const reply = await admin.next();
  admin.close();
  return reply;
}
