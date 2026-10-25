import { blake2s } from '@noble/hashes/blake2.js';

export function deviceIdOf(publicKey: Uint8Array): string {
  return Buffer.from(blake2s(publicKey)).toString('hex').slice(0, 8);
}
