import { publicKeyOf } from '@codevo-whisper/protocol';
import type { ServerPairing } from './pairing-repository';

type StoredPairing = {
  version: 1;
  devicePrivateKey: string;
  serverPublicKey: string;
  endpoint: string;
  deviceId: string;
  deviceName: string;
  pairedAt: string;
};

const KEY_BYTES = 32;
const DEVICE_ID = /^[0-9a-f]{8}$/;
const ENDPOINT_PROTOCOLS = ['ws:', 'wss:'];

const toText = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

function key(text: unknown, label: string): Uint8Array {
  const bytes = typeof text === 'string' ? new Uint8Array(Buffer.from(text, 'base64url')) : new Uint8Array(0);
  if (bytes.length !== KEY_BYTES) {
    throw new Error(`${label} must be ${KEY_BYTES} bytes`);
  }
  return bytes;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is missing`);
  }
  return value;
}

function endpoint(value: unknown): string {
  const url = text(value, 'endpoint');
  if (!URL.canParse(url) || !ENDPOINT_PROTOCOLS.includes(new URL(url).protocol)) {
    throw new Error('endpoint must be a ws:// or wss:// URL');
  }
  return url;
}

function deviceId(value: unknown): string {
  const id = text(value, 'deviceId');
  if (!DEVICE_ID.test(id)) {
    throw new Error('deviceId has an invalid format');
  }
  return id;
}

export function encodePairing(pairing: ServerPairing): string {
  const stored: StoredPairing = {
    version: 1,
    devicePrivateKey: toText(pairing.deviceKey.privateKey),
    serverPublicKey: toText(pairing.serverPublicKey),
    endpoint: pairing.endpoint,
    deviceId: pairing.deviceId,
    deviceName: pairing.deviceName,
    pairedAt: pairing.pairedAt,
  };
  return JSON.stringify(stored);
}

export function decodePairing(json: string): ServerPairing {
  const stored = JSON.parse(json) as Partial<StoredPairing>;
  if (stored.version !== 1) {
    throw new Error('the pairing has an unknown version');
  }
  const privateKey = key(stored.devicePrivateKey, 'devicePrivateKey');
  return {
    deviceKey: { privateKey, publicKey: publicKeyOf(privateKey) },
    serverPublicKey: key(stored.serverPublicKey, 'serverPublicKey'),
    endpoint: endpoint(stored.endpoint),
    deviceId: deviceId(stored.deviceId),
    deviceName: text(stored.deviceName, 'deviceName'),
    pairedAt: text(stored.pairedAt, 'pairedAt'),
  };
}
