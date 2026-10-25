import { describe, expect, it } from 'vitest';
import { ProtocolError } from '../src/errors';
import { generateKeyPair } from '../src/noise/primitives';
import { createPairingSecret, encodePairingToken, fingerprint, parsePairingToken, type PairingToken } from '../src/pairing';

function token(overrides: Partial<PairingToken> = {}): PairingToken {
  return {
    serverPublicKey: generateKeyPair().publicKey,
    secret: createPairingSecret(),
    endpoint: 'wss://whisper.example.com:8443/ws?x=1',
    ...overrides,
  };
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function expectBadMessage(text: string): void {
  expect(() => parsePairingToken(text)).toThrow(ProtocolError);
  expect(() => parsePairingToken(text)).toThrow(expect.objectContaining({ code: 'bad_message' }));
}

describe('pairing token', () => {
  it('round-trips a token', () => {
    const original = token();
    const text = encodePairingToken(original);

    expect(text.startsWith('cw1:')).toBe(true);
    expect(text.split(':')).toHaveLength(4);
    expect(text).not.toContain('=');
    expect(parsePairingToken(text)).toEqual(original);
  });

  it('creates a 32 byte random secret', () => {
    const first = createPairingSecret();

    expect(first).toHaveLength(32);
    expect(createPairingSecret()).not.toEqual(first);
  });

  it('trims surrounding whitespace when parsing', () => {
    const original = token({ endpoint: 'ws://127.0.0.1:8787' });

    expect(parsePairingToken(`  \n${encodePairingToken(original)}\t `)).toEqual(original);
  });

  it('rejects wrong prefix', () => {
    expectBadMessage(encodePairingToken(token()).replace(/^cw1:/, 'cw2:'));
  });

  it('rejects wrong key length (not 32 bytes)', () => {
    const valid = token();
    expectBadMessage(`cw1:${base64url(new Uint8Array(31))}:${base64url(valid.secret)}:${encodeURIComponent(valid.endpoint)}`);
    expect(() => encodePairingToken(token({ serverPublicKey: new Uint8Array(33) }))).toThrow(ProtocolError);
  });

  it('rejects wrong secret length (not 32 bytes)', () => {
    const valid = token();
    expectBadMessage(`cw1:${base64url(valid.serverPublicKey)}:${base64url(new Uint8Array(16))}:${encodeURIComponent(valid.endpoint)}`);
    expectBadMessage(`cw1:${base64url(valid.serverPublicKey)}:${base64url(new Uint8Array(33))}:${encodeURIComponent(valid.endpoint)}`);
    expect(() => encodePairingToken(token({ secret: new Uint8Array(16) }))).toThrow(ProtocolError);
  });

  it('rejects endpoint that is not ws:// or wss://', () => {
    const valid = token();
    const prefix = `cw1:${base64url(valid.serverPublicKey)}:${base64url(valid.secret)}`;
    expectBadMessage(`${prefix}:${encodeURIComponent('https://whisper.example.com')}`);
    expectBadMessage(`${prefix}:${encodeURIComponent('not a url')}`);
    expectBadMessage(`${prefix}:%E0%A4%A`);
    expect(() => encodePairingToken(token({ endpoint: 'http://127.0.0.1:8787' }))).toThrow(ProtocolError);
  });

  it('rejects malformed base64url and extra parts', () => {
    const valid = encodePairingToken(token());
    const [, key = '', secret = '', endpoint = ''] = valid.split(':');
    expectBadMessage(`cw1:${key}=:${secret}:${endpoint}`);
    expectBadMessage(`cw1:${key.replace(/^./, '+')}:${secret}:${endpoint}`);
    expectBadMessage(`${valid}:extra`);
    expectBadMessage('cw1:');
    expectBadMessage('');
  });
});

describe('fingerprint', () => {
  it('fingerprint has 8 groups of 4 hex chars', () => {
    expect(fingerprint(generateKeyPair().publicKey)).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){7}$/);
  });

  it('fingerprint is stable for the same input', () => {
    const key = generateKeyPair().publicKey;

    expect(fingerprint(Uint8Array.from(key))).toBe(fingerprint(key));
    expect(fingerprint(generateKeyPair().publicKey)).not.toBe(fingerprint(key));
  });

  it('is the first 16 bytes of BLAKE2s', () => {
    expect(fingerprint(new Uint8Array(0))).toBe('6921 7A30 7990 8094 E111 21D0 4235 4A7C');
  });
});

