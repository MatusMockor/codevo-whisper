import { blake2s } from '@noble/hashes/blake2.js';
import { badMessage } from './errors';
import { PROTOCOL_VERSION } from './version';

export type PairingToken = { serverPublicKey: Uint8Array; secret: Uint8Array; endpoint: string };

const KEY_BYTES = 32;
const SECRET_BYTES = 16;
const FINGERPRINT_BYTES = 16;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ENDPOINT_PROTOCOLS = ['ws:', 'wss:'];

export function createPairingSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
}

function encodeBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function decodeBase64url(text: string, expectedBytes: number, label: string): Uint8Array {
  if (!BASE64URL.test(text)) {
    throw badMessage(`${label} is not base64url`);
  }
  const bytes = new Uint8Array(Buffer.from(text, 'base64url'));
  if (bytes.length !== expectedBytes || encodeBase64url(bytes) !== text) {
    throw badMessage(`${label} must be ${expectedBytes} bytes`);
  }
  return bytes;
}

function assertEndpoint(endpoint: string): string {
  if (!URL.canParse(endpoint) || !ENDPOINT_PROTOCOLS.includes(new URL(endpoint).protocol)) {
    throw badMessage('endpoint must be a ws:// or wss:// URL');
  }
  return endpoint;
}

function decodeEndpoint(text: string): string {
  try {
    return assertEndpoint(decodeURIComponent(text));
  } catch (error) {
    if (error instanceof URIError) {
      throw badMessage('endpoint is not URI encoded', error);
    }
    throw error;
  }
}

function assertLength(bytes: Uint8Array, expected: number, label: string): void {
  if (bytes.length !== expected) {
    throw badMessage(`${label} must be ${expected} bytes`);
  }
}

export function encodePairingToken(token: PairingToken): string {
  assertLength(token.serverPublicKey, KEY_BYTES, 'server public key');
  assertLength(token.secret, SECRET_BYTES, 'pairing secret');
  const endpoint = encodeURIComponent(assertEndpoint(token.endpoint));
  return [PROTOCOL_VERSION, encodeBase64url(token.serverPublicKey), encodeBase64url(token.secret), endpoint].join(':');
}

export function parsePairingToken(text: string): PairingToken {
  const parts = text.trim().split(':');
  const [prefix, key, secret, endpoint] = parts;
  if (parts.length !== 4 || prefix !== PROTOCOL_VERSION || key === undefined || secret === undefined || endpoint === undefined) {
    throw badMessage('not a cw1 pairing token');
  }
  return {
    serverPublicKey: decodeBase64url(key, KEY_BYTES, 'server public key'),
    secret: decodeBase64url(secret, SECRET_BYTES, 'pairing secret'),
    endpoint: decodeEndpoint(endpoint),
  };
}

export function pairingPsk(secret: Uint8Array): Uint8Array {
  assertLength(secret, SECRET_BYTES, 'pairing secret');
  return blake2s(secret);
}

export function fingerprint(bytes: Uint8Array): string {
  const hex = Buffer.from(blake2s(bytes).subarray(0, FINGERPRINT_BYTES)).toString('hex').toUpperCase();
  return (hex.match(/.{4}/g) ?? []).join(' ');
}
