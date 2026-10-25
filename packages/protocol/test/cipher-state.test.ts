import { describe, expect, it } from 'vitest';
import { CipherState, MAX_NONCE } from '../src/noise/cipher-state';
import { NoiseError } from '../src/noise/noise-error';

const KEY = new Uint8Array(32).fill(9);
const EMPTY = new Uint8Array(0);
const PLAINTEXT = new TextEncoder().encode('ahoj svet');

describe('CipherState', () => {
  it('passes plaintext through without a key', () => {
    const cipher = new CipherState();

    expect(cipher.hasKey()).toBe(false);
    expect(cipher.encryptWithAd(EMPTY, PLAINTEXT)).toEqual(PLAINTEXT);
  });

  it('refuses to encrypt or decrypt at nonce 2^64 - 1', () => {
    const sender = new CipherState(KEY, MAX_NONCE - 1n);
    const receiver = new CipherState(KEY, MAX_NONCE - 1n);
    const last = sender.encryptWithAd(EMPTY, PLAINTEXT);

    expect(receiver.decryptWithAd(EMPTY, last)).toEqual(PLAINTEXT);
    expect(() => sender.encryptWithAd(EMPTY, PLAINTEXT)).toThrow(NoiseError);
    expect(() => receiver.decryptWithAd(EMPTY, last)).toThrow(NoiseError);
  });

  it('does not advance the nonce after a failed decryption', () => {
    const sender = new CipherState(KEY);
    const receiver = new CipherState(KEY);
    const ciphertext = sender.encryptWithAd(EMPTY, PLAINTEXT);
    const tampered = Uint8Array.from(ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;

    expect(() => receiver.decryptWithAd(EMPTY, tampered)).toThrow(NoiseError);
    expect(receiver.decryptWithAd(EMPTY, ciphertext)).toEqual(PLAINTEXT);
  });

  it('rejects ciphertext shorter than the tag', () => {
    expect(() => new CipherState(KEY).decryptWithAd(EMPTY, new Uint8Array(15))).toThrow(NoiseError);
  });

  it('rekeys both sides to the same new key', () => {
    const sender = new CipherState(KEY);
    const receiver = new CipherState(KEY);
    const stale = new CipherState(KEY);
    sender.rekey();
    receiver.rekey();
    const ciphertext = sender.encryptWithAd(EMPTY, PLAINTEXT);

    expect(receiver.decryptWithAd(EMPTY, ciphertext)).toEqual(PLAINTEXT);
    expect(() => stale.decryptWithAd(EMPTY, ciphertext)).toThrow(NoiseError);
  });
});
