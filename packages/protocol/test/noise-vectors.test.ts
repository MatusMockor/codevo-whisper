import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHandshake, type HandshakeState } from '../src/noise/handshake-state';
import type { HandshakePattern } from '../src/noise/patterns';
import { publicKeyOf, type KeyPair } from '../src/noise/primitives';
import { fromHex, toHex } from './support/hex';

type VectorMessage = { payload: string; ciphertext: string };

type Vector = {
  protocol_name: string;
  init_prologue: string;
  init_psks?: string[];
  init_static: string;
  init_ephemeral: string;
  init_remote_static: string;
  resp_prologue: string;
  resp_psks?: string[];
  resp_static: string;
  resp_ephemeral: string;
  handshake_hash: string;
  messages: VectorMessage[];
};

type VectorFile = { source: { repository: string; commit: string; file: string }; vectors: Vector[] };

const HANDSHAKE_MESSAGES = 2;
const EMPTY = new Uint8Array(0);

const file = JSON.parse(readFileSync(new URL('./vectors/noise-vectors.json', import.meta.url), 'utf8')) as VectorFile;

const PATTERNS: Record<string, HandshakePattern> = {
  Noise_IK_25519_ChaChaPoly_BLAKE2s: 'IK',
  Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s: 'IKpsk2',
};

function keyPair(privateKeyHex: string): KeyPair {
  const privateKey = fromHex(privateKeyHex);
  return { privateKey, publicKey: publicKeyOf(privateKey) };
}

function pskOptions(psks: string[] | undefined): { psk?: Uint8Array } {
  const [psk] = psks ?? [];
  if (psk === undefined) {
    return {};
  }
  return { psk: fromHex(psk) };
}

function patternOf(vector: Vector): HandshakePattern {
  const pattern = PATTERNS[vector.protocol_name];
  expect(pattern).toBeDefined();
  return pattern ?? 'IK';
}

function handshakes(vector: Vector): { initiator: HandshakeState; responder: HandshakeState } {
  const pattern = patternOf(vector);
  const initiator = createHandshake({
    pattern,
    initiator: true,
    prologue: fromHex(vector.init_prologue),
    staticKey: keyPair(vector.init_static),
    remoteStaticKey: fromHex(vector.init_remote_static),
    ephemeralKey: keyPair(vector.init_ephemeral),
    ...pskOptions(vector.init_psks),
  });
  const responder = createHandshake({
    pattern,
    initiator: false,
    prologue: fromHex(vector.resp_prologue),
    staticKey: keyPair(vector.resp_static),
    ephemeralKey: keyPair(vector.resp_ephemeral),
    ...pskOptions(vector.resp_psks),
  });
  return { initiator, responder };
}

describe('Noise test vectors', () => {
  it('pins the vector source commit', () => {
    expect(file.source.repository).toBe('https://github.com/haskell-cryptography/cacophony');
    expect(file.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(file.vectors.map((vector) => vector.protocol_name).sort()).toEqual([
      'Noise_IK_25519_ChaChaPoly_BLAKE2s',
      'Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s',
    ]);
  });

  describe.each(file.vectors.map((vector) => [vector.protocol_name, vector] as const))('%s', (_name, vector) => {
    it('replays the handshake and transport messages', () => {
      const { initiator, responder } = handshakes(vector);
      const handshakeMessages = vector.messages.slice(0, HANDSHAKE_MESSAGES);
      handshakeMessages.forEach((message, index) => {
        const [writer, reader] = index % 2 === 0 ? [initiator, responder] : [responder, initiator];
        const ciphertext = writer.writeMessage(fromHex(message.payload));
        expect(toHex(ciphertext)).toBe(message.ciphertext);
        expect(toHex(reader.readMessage(ciphertext))).toBe(message.payload);
      });

      expect(initiator.isComplete()).toBe(true);
      expect(responder.isComplete()).toBe(true);
      const initiatorResult = initiator.result();
      const responderResult = responder.result();
      expect(toHex(initiatorResult.handshakeHash)).toBe(vector.handshake_hash);
      expect(toHex(responderResult.handshakeHash)).toBe(vector.handshake_hash);

      vector.messages.slice(HANDSHAKE_MESSAGES).forEach((message, index) => {
        const [sender, receiver] = index % 2 === 0 ? [initiatorResult, responderResult] : [responderResult, initiatorResult];
        const ciphertext = sender.send.encryptWithAd(EMPTY, fromHex(message.payload));
        expect(toHex(ciphertext)).toBe(message.ciphertext);
        expect(toHex(receiver.receive.decryptWithAd(EMPTY, ciphertext))).toBe(message.payload);
      });
    });
  });
});
