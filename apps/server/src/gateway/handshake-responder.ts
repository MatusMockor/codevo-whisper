import {
  createHandshake,
  NoiseError,
  pairingPsk,
  PROLOGUE_PAIR,
  PROLOGUE_SESSION,
  ProtocolError,
  type HandshakeState,
  type KeyPair,
} from '@codevo-whisper/protocol';

function readFirstMessage(state: HandshakeState, noiseMessage: Uint8Array): HandshakeState {
  try {
    const payload = state.readMessage(noiseMessage);
    if (payload.length > 0) {
      throw new ProtocolError('bad_message', 'handshake payloads must be empty');
    }
    return state;
  } catch (error) {
    if (error instanceof NoiseError) {
      throw new ProtocolError('bad_message', 'handshake failed', { cause: error });
    }
    throw error;
  }
}

export function respondToSession(serverKey: KeyPair, noiseMessage: Uint8Array): HandshakeState {
  const state = createHandshake({ pattern: 'IK', initiator: false, prologue: PROLOGUE_SESSION, staticKey: serverKey });
  return readFirstMessage(state, noiseMessage);
}

export function respondToPairing(serverKey: KeyPair, secret: Uint8Array, noiseMessage: Uint8Array): HandshakeState {
  const state = createHandshake({
    pattern: 'IKpsk2',
    initiator: false,
    prologue: PROLOGUE_PAIR,
    staticKey: serverKey,
    psk: pairingPsk(secret),
  });
  return readFirstMessage(state, noiseMessage);
}
