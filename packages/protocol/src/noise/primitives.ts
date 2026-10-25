import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { blake2s } from '@noble/hashes/blake2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { NoiseError } from './noise-error';

export const DH_LENGTH = 32;
export const HASH_LENGTH = 32;
export const KEY_LENGTH = 32;
export const TAG_LENGTH = 16;

export type KeyPair = { publicKey: Uint8Array; privateKey: Uint8Array };

export function generateKeyPair(): KeyPair {
  const privateKey = x25519.utils.randomSecretKey();
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

export function publicKeyOf(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey);
}

export function dh(keyPair: KeyPair, publicKey: Uint8Array): Uint8Array {
  try {
    return x25519.getSharedSecret(keyPair.privateKey, publicKey);
  } catch {
    throw new NoiseError('invalid Diffie-Hellman public key');
  }
}

export function hash(data: Uint8Array): Uint8Array {
  return blake2s(data);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  parts.reduce((offset, part) => {
    result.set(part, offset);
    return offset + part.length;
  }, 0);
  return result;
}

function hmacHash(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(blake2s, key, data);
}

export function hkdf(chainingKey: Uint8Array, inputKeyMaterial: Uint8Array, outputs: 2 | 3): Uint8Array[] {
  const tempKey = hmacHash(chainingKey, inputKeyMaterial);
  const output1 = hmacHash(tempKey, Uint8Array.of(0x01));
  const output2 = hmacHash(tempKey, concat(output1, Uint8Array.of(0x02)));
  if (outputs === 2) {
    return [output1, output2];
  }
  return [output1, output2, hmacHash(tempKey, concat(output2, Uint8Array.of(0x03)))];
}

function nonceBytes(counter: bigint): Uint8Array {
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setBigUint64(4, counter, true);
  return nonce;
}

export function encrypt(key: Uint8Array, counter: bigint, ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
  return chacha20poly1305(key, nonceBytes(counter), ad).encrypt(plaintext);
}

export function decrypt(key: Uint8Array, counter: bigint, ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  if (ciphertext.length < TAG_LENGTH) {
    throw new NoiseError('ciphertext shorter than the authentication tag');
  }
  try {
    return chacha20poly1305(key, nonceBytes(counter), ad).decrypt(ciphertext);
  } catch {
    throw new NoiseError('decryption failed');
  }
}
