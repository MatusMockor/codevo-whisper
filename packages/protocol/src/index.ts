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
export { ERROR_CODES, isErrorCode, ProtocolError, type ErrorCode } from './errors';
export { decodeOpeningFrame, encodeOpeningFrame, HandshakeMode, PROLOGUE_PAIR, PROLOGUE_SESSION, type OpeningFrame } from './framing';
export { MAX_PLAINTEXT } from './limits';
export {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  LANGUAGES,
  MAX_DEVICE_NAME_CHARS,
  MAX_TEXT_CHARS,
  MessageTag,
  type ClientMessage,
  type Language,
  type ServerMessage,
} from './messages';
export { MAX_NOISE_MESSAGE, REKEY_EVERY, SecureTransport } from './transport/secure-transport';
