import { describe, expect, it } from 'vitest';
import { beginPairing, beginSession } from '../src/client/client-handshake';
import { ProtocolError } from '../src/errors';
import { decodeOpeningFrame, HandshakeMode, PROLOGUE_PAIR, PROLOGUE_SESSION } from '../src/framing';
import { createHandshake } from '../src/noise/handshake-state';
import { generateKeyPair } from '../src/noise/primitives';
import { createPairingSecret, pairingPsk } from '../src/pairing';
import { SecureTransport } from '../src/transport/secure-transport';

const EMPTY = new Uint8Array(0);

describe('client handshakes', () => {
  it('opens a session with an IK opening frame and completes on the reply', () => {
    const server = generateKeyPair();
    const device = generateKeyPair();
    const client = beginSession(device, server.publicKey);
    const opening = decodeOpeningFrame(client.openingFrame);
    const responder = createHandshake({ pattern: 'IK', initiator: false, prologue: PROLOGUE_SESSION, staticKey: server });

    expect(opening.mode).toBe(HandshakeMode.Session);
    expect(responder.readMessage(opening.noiseMessage)).toEqual(EMPTY);
    const reply = responder.writeMessage(EMPTY);
    const { transport, handshake } = client.complete(reply);
    const serverTransport = new SecureTransport(responder.result());

    expect(handshake.remoteStaticKey).toEqual(server.publicKey);
    expect(serverTransport.open(transport.seal(Uint8Array.of(1, 2)))).toEqual(Uint8Array.of(1, 2));
  });

  it('opens a pairing with an IKpsk2 opening frame keyed by the token secret', () => {
    const server = generateKeyPair();
    const secret = createPairingSecret();
    const client = beginPairing(generateKeyPair(), { serverPublicKey: server.publicKey, secret, endpoint: 'ws://127.0.0.1:8787' });
    const opening = decodeOpeningFrame(client.openingFrame);
    const responder = createHandshake({
      pattern: 'IKpsk2',
      initiator: false,
      prologue: PROLOGUE_PAIR,
      staticKey: server,
      psk: pairingPsk(secret),
    });

    expect(opening.mode).toBe(HandshakeMode.Pair);
    responder.readMessage(opening.noiseMessage);
    expect(client.complete(responder.writeMessage(EMPTY)).handshake.handshakeHash).toEqual(responder.result().handshakeHash);
  });

  it('rejects a reply from a server with another key or psk', () => {
    const server = generateKeyPair();
    const client = beginPairing(generateKeyPair(), {
      serverPublicKey: server.publicKey,
      secret: createPairingSecret(),
      endpoint: 'ws://127.0.0.1:8787',
    });
    const responder = createHandshake({
      pattern: 'IKpsk2',
      initiator: false,
      prologue: PROLOGUE_PAIR,
      staticKey: server,
      psk: pairingPsk(createPairingSecret()),
    });
    responder.readMessage(decodeOpeningFrame(client.openingFrame).noiseMessage);

    expect(() => client.complete(responder.writeMessage(EMPTY))).toThrow(ProtocolError);
  });

  it('rejects a reply that carries a payload', () => {
    const server = generateKeyPair();
    const client = beginSession(generateKeyPair(), server.publicKey);
    const responder = createHandshake({ pattern: 'IK', initiator: false, prologue: PROLOGUE_SESSION, staticKey: server });
    responder.readMessage(decodeOpeningFrame(client.openingFrame).noiseMessage);

    expect(() => client.complete(responder.writeMessage(Uint8Array.of(1)))).toThrow(ProtocolError);
  });
});
