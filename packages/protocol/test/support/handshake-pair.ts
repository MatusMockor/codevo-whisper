import { createHandshake, type HandshakeResult } from '../../src/noise/handshake-state';
import { generateKeyPair } from '../../src/noise/primitives';

const EMPTY = new Uint8Array(0);

export function completedHandshake(): { client: HandshakeResult; server: HandshakeResult } {
  const server = generateKeyPair();
  const prologue = new TextEncoder().encode('cw1/session');
  const initiator = createHandshake({
    pattern: 'IK',
    initiator: true,
    prologue,
    staticKey: generateKeyPair(),
    remoteStaticKey: server.publicKey,
  });
  const responder = createHandshake({ pattern: 'IK', initiator: false, prologue, staticKey: server });
  responder.readMessage(initiator.writeMessage(EMPTY));
  initiator.readMessage(responder.writeMessage(EMPTY));
  return { client: initiator.result(), server: responder.result() };
}
