import {
  beginPairing,
  beginSession,
  fingerprint,
  generateKeyPair,
  parsePairingToken,
  publicKeyOf,
  type KeyPair,
  type Language,
} from '@codevo-whisper/protocol';
import { base64urlnopad } from '@scure/base';
import { MobileConnection, type OpenWire } from './connection';
import { MobileSession } from './session';

export type Pairing = { deviceKey: KeyPair; serverPublicKey: Uint8Array; endpoint: string; deviceId: string };
export interface PairingVault {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
  remove(): Promise<void>;
}

export function serializePairing(pairing: Pairing): string {
  return JSON.stringify({
    version: 1,
    privateKey: base64urlnopad.encode(pairing.deviceKey.privateKey),
    serverPublicKey: base64urlnopad.encode(pairing.serverPublicKey),
    endpoint: pairing.endpoint,
    deviceId: pairing.deviceId,
  });
}

export function parsePairing(text: string): Pairing {
  const value: unknown = JSON.parse(text);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    value.version !== 1 ||
    !('privateKey' in value) ||
    typeof value.privateKey !== 'string' ||
    !('serverPublicKey' in value) ||
    typeof value.serverPublicKey !== 'string' ||
    !('endpoint' in value) ||
    typeof value.endpoint !== 'string' ||
    !('deviceId' in value) ||
    typeof value.deviceId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(value.deviceId)
  ) {
    throw new Error('Invalid protected pairing');
  }
  const privateKey = base64urlnopad.decode(value.privateKey);
  const serverPublicKey = base64urlnopad.decode(value.serverPublicKey);
  if (privateKey.length !== 32 || serverPublicKey.length !== 32 || !['ws:', 'wss:'].includes(new URL(value.endpoint).protocol)) {
    throw new Error('Invalid protected pairing');
  }
  return {
    deviceKey: { privateKey, publicKey: publicKeyOf(privateKey) },
    serverPublicKey,
    endpoint: value.endpoint,
    deviceId: value.deviceId,
  };
}

export async function pairDevice(args: {
  token: string;
  name: string;
  vault: PairingVault;
  open: OpenWire;
  signal: AbortSignal;
  awaitingApproval: (fingerprints: { connection: string; device: string; server: string }) => void;
}): Promise<Pairing> {
  const token = parsePairingToken(args.token);
  if (args.name.trim().length === 0 || [...args.name].length > 64 || /\p{Cc}/u.test(args.name)) {
    throw new Error('Enter a device name of 1 to 64 characters');
  }
  const existing = await args.vault.load();
  if (args.signal.aborted) {
    throw new Error('Pairing cancelled');
  }
  const deviceKey = existing === null ? generateKeyPair() : parsePairing(existing).deviceKey;
  const connection = await MobileConnection.connect(token.endpoint, beginPairing(deviceKey, token), args.open, args.signal);
  try {
    args.awaitingApproval({
      connection: fingerprint(connection.handshakeFingerprint),
      device: fingerprint(deviceKey.publicKey),
      server: fingerprint(token.serverPublicKey),
    });
    connection.send({ type: 'pair-request', deviceName: args.name });
    const response = await connection.next(120_000);
    if (response.type !== 'pair-result' || response.status !== 'approved' || response.deviceId === undefined || args.signal.aborted) {
      throw new Error('Pairing was not approved');
    }
    const pairing = { deviceKey, serverPublicKey: token.serverPublicKey, endpoint: token.endpoint, deviceId: response.deviceId };
    await args.vault.save(serializePairing(pairing));
    return pairing;
  } finally {
    connection.close();
  }
}

export async function startSession(
  pairing: Pairing,
  runId: string,
  language: Language,
  open: OpenWire,
  signal: AbortSignal,
): Promise<MobileSession> {
  const connection = await MobileConnection.connect(
    pairing.endpoint,
    beginSession(pairing.deviceKey, pairing.serverPublicKey),
    open,
    signal,
  );
  try {
    connection.send({ type: 'hello' });
    const ready = await connection.next();
    if (ready.type !== 'ready' || signal.aborted) {
      throw new Error(ready.type === 'error' ? `Server error: ${ready.code}` : 'Server was not ready');
    }
    return new MobileSession(connection, runId, language);
  } catch (error) {
    connection.close();
    throw error;
  }
}
