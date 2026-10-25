export const PROTOCOL_VERSION = 'cw1';

export { CipherState, MAX_NONCE } from './noise/cipher-state';
export {
  createHandshake,
  MAX_HANDSHAKE_MESSAGE,
  type HandshakeOptions,
  type HandshakeResult,
  type HandshakeState,
} from './noise/handshake-state';
export { NoiseError } from './noise/noise-error';
export type { HandshakePattern } from './noise/patterns';
export { generateKeyPair, publicKeyOf, type KeyPair } from './noise/primitives';
