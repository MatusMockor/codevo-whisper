import { ByteReader } from './byte-reader';
import type { CipherState } from './cipher-state';
import { validateHandshakeOptions, type HandshakeOptions } from './handshake-options';
import { NoiseError } from './noise-error';
import { PATTERNS, type PatternDefinition, type Token } from './patterns';
import { concat, dh, DH_LENGTH, generateKeyPair, TAG_LENGTH, type KeyPair } from './primitives';
import { SymmetricState } from './symmetric-state';

export type { HandshakeOptions } from './handshake-options';

export const MAX_HANDSHAKE_MESSAGE = 65535;

export type HandshakeResult = {
  send: CipherState;
  receive: CipherState;
  handshakeHash: Uint8Array;
  remoteStaticKey: Uint8Array;
};

export interface HandshakeState {
  writeMessage(payload: Uint8Array): Uint8Array;
  readMessage(message: Uint8Array): Uint8Array;
  isComplete(): boolean;
  result(): HandshakeResult;
}

type DhToken = 'ee' | 'es' | 'se' | 'ss';

class NoiseHandshake implements HandshakeState {
  private readonly symmetric: SymmetricState;
  private readonly pattern: PatternDefinition;
  private readonly initiator: boolean;
  private readonly staticKey: KeyPair;
  private readonly psk: Uint8Array | undefined;
  private ephemeralKey: KeyPair | undefined;
  private remoteStaticKey: Uint8Array | undefined;
  private remoteEphemeralKey: Uint8Array | undefined;
  private messageIndex = 0;
  private failed = false;
  private completed: HandshakeResult | undefined;

  constructor(options: HandshakeOptions) {
    validateHandshakeOptions(options);
    this.pattern = PATTERNS[options.pattern];
    this.initiator = options.initiator;
    this.staticKey = options.staticKey;
    this.ephemeralKey = options.ephemeralKey;
    this.remoteStaticKey = options.remoteStaticKey;
    this.psk = options.psk;
    this.symmetric = new SymmetricState(this.pattern.protocolName);
    this.symmetric.mixHash(options.prologue);
    this.pattern.responderPreMessage.forEach(() => this.symmetric.mixHash(this.responderStaticPublicKey()));
  }

  writeMessage(payload: Uint8Array): Uint8Array {
    const tokens = this.nextTokens(true);
    return this.guard(() => {
      const parts = tokens.map((token) => this.writeToken(token));
      const message = concat(...parts, this.symmetric.encryptAndHash(payload));
      if (message.length > MAX_HANDSHAKE_MESSAGE) {
        throw new NoiseError('handshake message exceeds 65535 bytes');
      }
      this.advance();
      return message;
    });
  }

  readMessage(message: Uint8Array): Uint8Array {
    const tokens = this.nextTokens(false);
    return this.guard(() => {
      if (message.length > MAX_HANDSHAKE_MESSAGE) {
        throw new NoiseError('handshake message exceeds 65535 bytes');
      }
      const reader = new ByteReader(message);
      tokens.forEach((token) => this.readToken(token, reader));
      const payload = this.symmetric.decryptAndHash(reader.rest());
      this.advance();
      return payload;
    });
  }

  isComplete(): boolean {
    return this.completed !== undefined;
  }

  result(): HandshakeResult {
    if (this.completed === undefined) {
      throw new NoiseError('handshake is not complete');
    }
    return this.completed;
  }

  private guard<T>(work: () => T): T {
    try {
      return work();
    } catch (error) {
      this.failed = true;
      if (error instanceof NoiseError) {
        throw error;
      }
      throw new NoiseError('handshake failed', { cause: error });
    }
  }

  private nextTokens(writing: boolean): readonly Token[] {
    if (this.failed) {
      throw new NoiseError('handshake has failed');
    }
    const tokens = this.pattern.messages[this.messageIndex];
    if (tokens === undefined) {
      throw new NoiseError('handshake is already complete');
    }
    const initiatorTurn = this.messageIndex % 2 === 0;
    if (initiatorTurn !== (this.initiator === writing)) {
      throw new NoiseError('handshake message out of turn');
    }
    return tokens;
  }

  private advance(): void {
    this.messageIndex += 1;
    if (this.messageIndex < this.pattern.messages.length) {
      return;
    }
    const [first, second] = this.symmetric.split();
    const [send, receive] = this.initiator ? [first, second] : [second, first];
    this.completed = {
      send,
      receive,
      handshakeHash: this.symmetric.getHandshakeHash(),
      remoteStaticKey: required(this.remoteStaticKey, 'remote static key'),
    };
  }

  private writeToken(token: Token): Uint8Array {
    if (token === 'e') {
      const ephemeral = this.ephemeralKey ?? generateKeyPair();
      this.ephemeralKey = ephemeral;
      this.mixEphemeral(ephemeral.publicKey);
      return ephemeral.publicKey;
    }
    if (token === 's') {
      return this.symmetric.encryptAndHash(this.staticKey.publicKey);
    }
    this.mixToken(token);
    return new Uint8Array(0);
  }

  private readToken(token: Token, reader: ByteReader): void {
    if (token === 'e') {
      this.remoteEphemeralKey = Uint8Array.from(reader.take(DH_LENGTH));
      this.mixEphemeral(this.remoteEphemeralKey);
      return;
    }
    if (token === 's') {
      const length = this.symmetric.hasKey() ? DH_LENGTH + TAG_LENGTH : DH_LENGTH;
      this.remoteStaticKey = this.symmetric.decryptAndHash(reader.take(length));
      return;
    }
    this.mixToken(token);
  }

  private mixEphemeral(publicKey: Uint8Array): void {
    this.symmetric.mixHash(publicKey);
    if (this.pattern.usesPsk) {
      this.symmetric.mixKey(publicKey);
    }
  }

  private mixToken(token: Exclude<Token, 'e' | 's'>): void {
    if (token === 'psk') {
      this.symmetric.mixKeyAndHash(required(this.psk, 'psk'));
      return;
    }
    this.symmetric.mixKey(this.dhFor(token));
  }

  private dhFor(token: DhToken): Uint8Array {
    const ephemeral = (): KeyPair => required(this.ephemeralKey, 'local ephemeral key');
    const remoteEphemeral = (): Uint8Array => required(this.remoteEphemeralKey, 'remote ephemeral key');
    const remoteStatic = (): Uint8Array => required(this.remoteStaticKey, 'remote static key');
    if (token === 'ee') {
      return dh(ephemeral(), remoteEphemeral());
    }
    if (token === 'ss') {
      return dh(this.staticKey, remoteStatic());
    }
    const localIsEphemeral = (token === 'es') === this.initiator;
    if (localIsEphemeral) {
      return dh(ephemeral(), remoteStatic());
    }
    return dh(this.staticKey, remoteEphemeral());
  }

  private responderStaticPublicKey(): Uint8Array {
    if (this.initiator) {
      return required(this.remoteStaticKey, 'remote static key');
    }
    return this.staticKey.publicKey;
  }
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new NoiseError(`missing ${label}`);
  }
  return value;
}

export function createHandshake(options: HandshakeOptions): HandshakeState {
  return new NoiseHandshake(options);
}
