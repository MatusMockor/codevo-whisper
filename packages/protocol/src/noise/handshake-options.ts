import { NoiseError } from './noise-error';
import type { HandshakePattern } from './patterns';
import { PATTERNS } from './patterns';
import { DH_LENGTH, KEY_LENGTH, type KeyPair } from './primitives';

export type HandshakeOptions = {
  pattern: HandshakePattern;
  initiator: boolean;
  prologue: Uint8Array;
  staticKey: KeyPair;
  remoteStaticKey?: Uint8Array;
  psk?: Uint8Array;
  ephemeralKey?: KeyPair;
};

function assertKeyPair(keyPair: KeyPair, label: string): void {
  if (keyPair.privateKey.length !== DH_LENGTH || keyPair.publicKey.length !== DH_LENGTH) {
    throw new NoiseError(`${label} must be ${DH_LENGTH} bytes`);
  }
}

function assertRemoteStaticKey(options: HandshakeOptions): void {
  if (!options.initiator && options.remoteStaticKey !== undefined) {
    throw new NoiseError('the responder learns the remote static key from the handshake');
  }
  if (options.initiator && options.remoteStaticKey?.length !== DH_LENGTH) {
    throw new NoiseError(`the initiator needs the ${DH_LENGTH} byte responder static key`);
  }
}

function assertPsk(options: HandshakeOptions): void {
  const usesPsk = PATTERNS[options.pattern].usesPsk;
  if (!usesPsk && options.psk !== undefined) {
    throw new NoiseError(`${options.pattern} does not use a psk`);
  }
  if (usesPsk && options.psk?.length !== KEY_LENGTH) {
    throw new NoiseError(`${options.pattern} needs a ${KEY_LENGTH} byte psk`);
  }
}

export function validateHandshakeOptions(options: HandshakeOptions): void {
  assertKeyPair(options.staticKey, 'static key');
  if (options.ephemeralKey !== undefined) {
    assertKeyPair(options.ephemeralKey, 'ephemeral key');
  }
  assertRemoteStaticKey(options);
  assertPsk(options);
}
