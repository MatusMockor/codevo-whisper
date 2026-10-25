import { CipherState } from './cipher-state';
import { concat, hash, HASH_LENGTH, hkdf } from './primitives';

const EMPTY = new Uint8Array(0);

function initialHash(protocolName: string): Uint8Array {
  const name = new TextEncoder().encode(protocolName);
  if (name.length > HASH_LENGTH) {
    return hash(name);
  }
  const padded = new Uint8Array(HASH_LENGTH);
  padded.set(name);
  return padded;
}

export class SymmetricState {
  private cipher = new CipherState();
  private chainingKey: Uint8Array;
  private handshakeHash: Uint8Array;

  constructor(protocolName: string) {
    this.handshakeHash = initialHash(protocolName);
    this.chainingKey = this.handshakeHash;
  }

  hasKey(): boolean {
    return this.cipher.hasKey();
  }

  mixKey(inputKeyMaterial: Uint8Array): void {
    const [chainingKey, tempKey] = hkdf(this.chainingKey, inputKeyMaterial, 2);
    this.chainingKey = chainingKey ?? EMPTY;
    this.cipher = new CipherState(tempKey ?? null);
  }

  mixHash(data: Uint8Array): void {
    this.handshakeHash = hash(concat(this.handshakeHash, data));
  }

  mixKeyAndHash(inputKeyMaterial: Uint8Array): void {
    const [chainingKey, tempHash, tempKey] = hkdf(this.chainingKey, inputKeyMaterial, 3);
    this.chainingKey = chainingKey ?? EMPTY;
    this.mixHash(tempHash ?? EMPTY);
    this.cipher = new CipherState(tempKey ?? null);
  }

  getHandshakeHash(): Uint8Array {
    return Uint8Array.from(this.handshakeHash);
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const ciphertext = this.cipher.encryptWithAd(this.handshakeHash, plaintext);
    this.mixHash(ciphertext);
    return ciphertext;
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    const plaintext = this.cipher.decryptWithAd(this.handshakeHash, ciphertext);
    this.mixHash(ciphertext);
    return plaintext;
  }

  split(): [CipherState, CipherState] {
    const [first, second] = hkdf(this.chainingKey, EMPTY, 2);
    return [new CipherState(first ?? null), new CipherState(second ?? null)];
  }
}
