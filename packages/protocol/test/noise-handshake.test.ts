import { describe, expect, it } from 'vitest';
import { createHandshake, type HandshakeState } from '../src/noise/handshake-state';
import { NoiseError } from '../src/noise/noise-error';
import type { HandshakePattern } from '../src/noise/patterns';
import { generateKeyPair, type KeyPair } from '../src/noise/primitives';

const PROLOGUE = new TextEncoder().encode('cw1/test');
const EMPTY = new Uint8Array(0);

type Pair = { initiator: HandshakeState; responder: HandshakeState; client: KeyPair; server: KeyPair };

type PairOptions = {
  pattern?: HandshakePattern;
  initiatorPsk?: Uint8Array;
  responderPsk?: Uint8Array;
  responderPrologue?: Uint8Array;
  expectedServerKey?: Uint8Array;
};

function psk(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function optionalPsk(value: Uint8Array | undefined): { psk?: Uint8Array } {
  if (value === undefined) {
    return {};
  }
  return { psk: value };
}

function pair(options: PairOptions = {}): Pair {
  const pattern = options.pattern ?? 'IK';
  const client = generateKeyPair();
  const server = generateKeyPair();
  const initiator = createHandshake({
    pattern,
    initiator: true,
    prologue: PROLOGUE,
    staticKey: client,
    remoteStaticKey: options.expectedServerKey ?? server.publicKey,
    ...optionalPsk(options.initiatorPsk),
  });
  const responder = createHandshake({
    pattern,
    initiator: false,
    prologue: options.responderPrologue ?? PROLOGUE,
    staticKey: server,
    ...optionalPsk(options.responderPsk),
  });
  return { initiator, responder, client, server };
}

function flipByte(message: Uint8Array, index: number): Uint8Array {
  const copy = Uint8Array.from(message);
  copy[index] = (copy[index] ?? 0) ^ 0x01;
  return copy;
}

describe('Noise handshake', () => {
  it('completes IK and IKpsk2 and derives matching transport keys', () => {
    const cases: Pair[] = [pair(), pair({ pattern: 'IKpsk2', initiatorPsk: psk(7), responderPsk: psk(7) })];
    cases.forEach(({ initiator, responder }) => {
      responder.readMessage(initiator.writeMessage(EMPTY));
      initiator.readMessage(responder.writeMessage(EMPTY));
      const client = initiator.result();
      const server = responder.result();
      const plaintext = new TextEncoder().encode('ahoj');

      expect(server.receive.decryptWithAd(EMPTY, client.send.encryptWithAd(EMPTY, plaintext))).toEqual(plaintext);
      expect(client.receive.decryptWithAd(EMPTY, server.send.encryptWithAd(EMPTY, plaintext))).toEqual(plaintext);
      expect(client.handshakeHash).toEqual(server.handshakeHash);
    });
  });

  it('rejects a tampered handshake message', () => {
    const first = pair();
    const message = first.initiator.writeMessage(EMPTY);
    expect(() => first.responder.readMessage(flipByte(message, message.length - 1))).toThrow(NoiseError);

    const second = pair();
    second.responder.readMessage(second.initiator.writeMessage(EMPTY));
    const reply = second.responder.writeMessage(EMPTY);
    expect(() => second.initiator.readMessage(flipByte(reply, 40))).toThrow(NoiseError);
  });

  it('rejects a truncated handshake message', () => {
    const { initiator, responder } = pair();
    const message = initiator.writeMessage(EMPTY);

    expect(() => responder.readMessage(message.subarray(0, 40))).toThrow(NoiseError);
  });

  it('rejects a wrong psk', () => {
    const { initiator, responder } = pair({ pattern: 'IKpsk2', initiatorPsk: psk(1), responderPsk: psk(2) });
    responder.readMessage(initiator.writeMessage(EMPTY));

    expect(() => initiator.readMessage(responder.writeMessage(EMPTY))).toThrow(NoiseError);
  });

  it('rejects a wrong prologue', () => {
    const { initiator, responder } = pair({ responderPrologue: new TextEncoder().encode('cw1/other') });

    expect(() => responder.readMessage(initiator.writeMessage(EMPTY))).toThrow(NoiseError);
  });

  it('rejects a responder with a different static key', () => {
    const { initiator, responder } = pair({ expectedServerKey: generateKeyPair().publicKey });

    expect(() => responder.readMessage(initiator.writeMessage(EMPTY))).toThrow(NoiseError);
  });

  it('exposes the initiator static key to the responder', () => {
    const { initiator, responder, client, server } = pair();
    responder.readMessage(initiator.writeMessage(EMPTY));
    initiator.readMessage(responder.writeMessage(EMPTY));

    expect(responder.result().remoteStaticKey).toEqual(client.publicKey);
    expect(initiator.result().remoteStaticKey).toEqual(server.publicKey);
  });

  it('exposes the initiator static key to the responder after the first message', () => {
    const { initiator, responder, client } = pair();

    expect(responder.remoteStaticKey()).toBeNull();
    responder.readMessage(initiator.writeMessage(EMPTY));
    expect(responder.isComplete()).toBe(false);
    expect(responder.remoteStaticKey()).toEqual(client.publicKey);
  });

  it('rejects messages out of turn and results before completion', () => {
    const { initiator, responder } = pair();

    expect(() => responder.writeMessage(EMPTY)).toThrow(NoiseError);
    expect(() => initiator.result()).toThrow(NoiseError);
    initiator.writeMessage(EMPTY);
    expect(() => initiator.writeMessage(EMPTY)).toThrow(NoiseError);
  });

  it('refuses further use after a failed read', () => {
    const { initiator, responder } = pair();
    const message = initiator.writeMessage(EMPTY);
    expect(() => responder.readMessage(flipByte(message, 50))).toThrow(NoiseError);

    expect(() => responder.readMessage(message)).toThrow(NoiseError);
  });

  it('requires the remote static key for an initiator and a 32 byte psk for IKpsk2', () => {
    const keys = generateKeyPair();

    expect(() => createHandshake({ pattern: 'IK', initiator: true, prologue: PROLOGUE, staticKey: keys })).toThrow(NoiseError);
    expect(() =>
      createHandshake({ pattern: 'IKpsk2', initiator: false, prologue: PROLOGUE, staticKey: keys, psk: new Uint8Array(16) }),
    ).toThrow(NoiseError);
    expect(() => createHandshake({ pattern: 'IKpsk2', initiator: false, prologue: PROLOGUE, staticKey: keys })).toThrow(NoiseError);
  });
});
