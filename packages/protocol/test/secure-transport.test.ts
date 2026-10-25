import { describe, expect, it } from 'vitest';
import { ProtocolError } from '../src/errors';
import { MAX_NOISE_MESSAGE, SecureTransport } from '../src/transport/secure-transport';
import { completedHandshake } from './support/handshake-pair';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function transports(rekeyEvery?: number): { client: SecureTransport; server: SecureTransport } {
  const { client, server } = completedHandshake();
  return { client: new SecureTransport(client, rekeyEvery), server: new SecureTransport(server, rekeyEvery) };
}

describe('SecureTransport', () => {
  it('round-trips messages both ways', () => {
    const { client, server } = transports();

    expect(decoder.decode(server.open(client.seal(encoder.encode('ahoj'))))).toBe('ahoj');
    expect(decoder.decode(client.open(server.seal(encoder.encode('svet'))))).toBe('svet');
    expect(decoder.decode(server.open(client.seal(encoder.encode('znova'))))).toBe('znova');
  });

  it('rejects replayed ciphertext', () => {
    const { client, server } = transports();
    const ciphertext = client.seal(encoder.encode('raz'));
    server.open(ciphertext);

    expect(() => server.open(ciphertext)).toThrow(ProtocolError);
  });

  it('rejects reordered ciphertext', () => {
    const { client, server } = transports();
    const first = client.seal(encoder.encode('prvy'));
    const second = client.seal(encoder.encode('druhy'));

    expect(() => server.open(second)).toThrow(ProtocolError);
    expect(decoder.decode(server.open(first))).toBe('prvy');
  });

  it('rejects truncated ciphertext', () => {
    const { client, server } = transports();
    const ciphertext = client.seal(encoder.encode('cele'));

    expect(() => server.open(ciphertext.subarray(0, ciphertext.length - 1))).toThrow(ProtocolError);
  });

  it('rekeys after REKEY_EVERY messages and keeps working', () => {
    const { client, server } = transports(3);
    const messages = Array.from({ length: 10 }, (_, index) => encoder.encode(`sprava ${index}`));

    messages.forEach((message) => {
      expect(server.open(client.seal(message))).toEqual(message);
      expect(client.open(server.seal(message))).toEqual(message);
    });
  });

  it('changes the key after rekeying', () => {
    const { client, server } = transports(2);
    const rekeyed = completedHandshake();
    const withRekey = new SecureTransport(rekeyed.client, 2);
    const withoutRekey = new SecureTransport(rekeyed.server, 1000);
    server.open(client.seal(encoder.encode('a')));
    server.open(client.seal(encoder.encode('b')));
    withoutRekey.open(withRekey.seal(encoder.encode('a')));
    withoutRekey.open(withRekey.seal(encoder.encode('b')));

    expect(decoder.decode(server.open(client.seal(encoder.encode('c'))))).toBe('c');
    expect(() => withoutRekey.open(withRekey.seal(encoder.encode('c')))).toThrow(ProtocolError);
  });

  it('rejects plaintext larger than MAX_NOISE_MESSAGE - 16', () => {
    const { client, server } = transports();

    expect(server.open(client.seal(new Uint8Array(MAX_NOISE_MESSAGE - 16))).length).toBe(MAX_NOISE_MESSAGE - 16);
    expect(() => client.seal(new Uint8Array(MAX_NOISE_MESSAGE - 15))).toThrow(ProtocolError);
  });

  it('rejects ciphertext larger than MAX_NOISE_MESSAGE', () => {
    const { server } = transports();

    expect(() => server.open(new Uint8Array(MAX_NOISE_MESSAGE + 1))).toThrow(ProtocolError);
  });
});
