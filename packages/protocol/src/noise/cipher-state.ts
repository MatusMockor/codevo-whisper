import { NoiseError } from './noise-error';
import { decrypt, encrypt, KEY_LENGTH } from './primitives';

export const MAX_NONCE = 2n ** 64n - 1n;

const ZEROS = new Uint8Array(KEY_LENGTH);
const EMPTY = new Uint8Array(0);

export class CipherState {
  private key: Uint8Array | null;
  private nonce: bigint;

  constructor(key: Uint8Array | null = null, nonce = 0n) {
    this.key = key;
    this.nonce = nonce;
  }

  hasKey(): boolean {
    return this.key !== null;
  }

  encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    if (this.key === null) {
      return Uint8Array.from(plaintext);
    }
    this.assertNonceAvailable();
    const ciphertext = encrypt(this.key, this.nonce, ad, plaintext);
    this.nonce += 1n;
    return ciphertext;
  }

  decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    if (this.key === null) {
      return Uint8Array.from(ciphertext);
    }
    this.assertNonceAvailable();
    const plaintext = decrypt(this.key, this.nonce, ad, ciphertext);
    this.nonce += 1n;
    return plaintext;
  }

  rekey(): void {
    if (this.key === null) {
      throw new NoiseError('cannot rekey a cipher without a key');
    }
    this.key = encrypt(this.key, MAX_NONCE, EMPTY, ZEROS).subarray(0, KEY_LENGTH);
  }

  private assertNonceAvailable(): void {
    if (this.nonce >= MAX_NONCE) {
      throw new NoiseError('nonce exhausted');
    }
  }
}
