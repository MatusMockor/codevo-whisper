import { badMessage } from '../errors';
import { encodeOpeningFrame, HandshakeMode, PROLOGUE_PAIR, PROLOGUE_SESSION } from '../framing';
import { createHandshake, type HandshakeResult, type HandshakeState } from '../noise/handshake-state';
import { NoiseError } from '../noise/noise-error';
import type { KeyPair } from '../noise/primitives';
import type { PairingToken } from '../pairing';
import { SecureTransport } from '../transport/secure-transport';

const EMPTY = new Uint8Array(0);

export type CompletedHandshake = { transport: SecureTransport; handshake: HandshakeResult };

export interface ClientHandshake {
  readonly openingFrame: Uint8Array;
  complete(reply: Uint8Array): CompletedHandshake;
}

function readReply(state: HandshakeState, reply: Uint8Array): HandshakeResult {
  try {
    const payload = state.readMessage(reply);
    if (payload.length > 0) {
      throw badMessage('handshake reply must not carry a payload');
    }
    return state.result();
  } catch (error) {
    if (error instanceof NoiseError) {
      throw badMessage('the server handshake reply could not be authenticated', error);
    }
    throw error;
  }
}

function begin(mode: HandshakeMode, state: HandshakeState): ClientHandshake {
  const openingFrame = encodeOpeningFrame(mode, state.writeMessage(EMPTY));
  return {
    openingFrame,
    complete(reply) {
      const handshake = readReply(state, reply);
      return { transport: new SecureTransport(handshake), handshake };
    },
  };
}

export function beginSession(device: KeyPair, serverPublicKey: Uint8Array): ClientHandshake {
  const state = createHandshake({
    pattern: 'IK',
    initiator: true,
    prologue: PROLOGUE_SESSION,
    staticKey: device,
    remoteStaticKey: serverPublicKey,
  });
  return begin(HandshakeMode.Session, state);
}

export function beginPairing(device: KeyPair, token: PairingToken): ClientHandshake {
  const state = createHandshake({
    pattern: 'IKpsk2',
    initiator: true,
    prologue: PROLOGUE_PAIR,
    staticKey: device,
    remoteStaticKey: token.serverPublicKey,
    psk: token.secret,
  });
  return begin(HandshakeMode.Pair, state);
}
