import type { PairingDecision } from '../pairing/pairing-operator';

export type AdminCommand =
  | { cmd: 'pair'; ttlMs?: number }
  | { cmd: 'devices' }
  | { cmd: 'revoke'; deviceId: string }
  | { cmd: 'rotate-key' }
  | { cmd: 'status' };

export type ParsedCommand = { ok: true; command: AdminCommand } | { ok: false; error: string };

const MAX_TTL_MS = 86_400_000;
const DEVICE_ID = /^[0-9a-f]{8}$/;

function parseJson(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function invalid(error: string): ParsedCommand {
  return { ok: false, error };
}

function parsePair(object: Record<string, unknown>): ParsedCommand {
  const { ttlMs } = object;
  if (ttlMs === undefined) {
    return { ok: true, command: { cmd: 'pair' } };
  }
  if (typeof ttlMs !== 'number' || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL_MS) {
    return invalid(`ttlMs must be an integer between 1 and ${MAX_TTL_MS}`);
  }
  return { ok: true, command: { cmd: 'pair', ttlMs } };
}

function parseRevoke(object: Record<string, unknown>): ParsedCommand {
  const { deviceId } = object;
  if (typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId)) {
    return invalid('deviceId must be 8 lowercase hex characters');
  }
  return { ok: true, command: { cmd: 'revoke', deviceId } };
}

export function parseAdminCommand(line: string): ParsedCommand {
  const object = parseJson(line);
  if (object === null) {
    return invalid('expected a JSON object');
  }
  if (object.cmd === 'pair') {
    return parsePair(object);
  }
  if (object.cmd === 'revoke') {
    return parseRevoke(object);
  }
  if (object.cmd === 'devices' || object.cmd === 'rotate-key' || object.cmd === 'status') {
    return { ok: true, command: { cmd: object.cmd } };
  }
  return invalid('unknown command');
}

export function parseDecision(line: string): PairingDecision | null {
  const object = parseJson(line);
  if (object?.decision === 'approve' || object?.decision === 'reject') {
    return object.decision;
  }
  return null;
}
