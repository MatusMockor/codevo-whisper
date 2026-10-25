import { badMessage } from '../errors';
import { MAX_NOISE_MESSAGE, MAX_PLAINTEXT, REKEY_EVERY } from '../limits';
import type { CipherState } from '../noise/cipher-state';
import type { HandshakeResult } from '../noise/handshake-state';
import { NoiseError } from '../noise/noise-error';

export { MAX_NOISE_MESSAGE, REKEY_EVERY } from '../limits';

const EMPTY = new Uint8Array(0);

class Direction {
  private count = 0;

  constructor(
    private readonly cipher: CipherState,
    private readonly rekeyEvery: number,
  ) {}

  apply(work: (cipher: CipherState) => Uint8Array): Uint8Array {
    const result = work(this.cipher);
    this.count += 1;
    if (this.count % this.rekeyEvery === 0) {
      this.cipher.rekey();
    }
    return result;
  }
}

export class SecureTransport {
  private readonly sending: Direction;
  private readonly receiving: Direction;

  constructor(result: HandshakeResult, rekeyEvery = REKEY_EVERY) {
    if (!Number.isSafeInteger(rekeyEvery) || rekeyEvery < 1) {
      throw new RangeError('rekeyEvery must be a positive integer');
    }
    this.sending = new Direction(result.send, rekeyEvery);
    this.receiving = new Direction(result.receive, rekeyEvery);
  }

  seal(plaintext: Uint8Array): Uint8Array {
    if (plaintext.length > MAX_PLAINTEXT) {
      throw badMessage(`plaintext exceeds ${MAX_PLAINTEXT} bytes`);
    }
    return this.sending.apply((cipher) => cipher.encryptWithAd(EMPTY, plaintext));
  }

  open(ciphertext: Uint8Array): Uint8Array {
    if (ciphertext.length > MAX_NOISE_MESSAGE) {
      throw badMessage(`ciphertext exceeds ${MAX_NOISE_MESSAGE} bytes`);
    }
    return this.receiving.apply((cipher) => decryptOrReject(cipher, ciphertext));
  }
}

function decryptOrReject(cipher: CipherState, ciphertext: Uint8Array): Uint8Array {
  try {
    return cipher.decryptWithAd(EMPTY, ciphertext);
  } catch (error) {
    if (error instanceof NoiseError) {
      throw badMessage('ciphertext could not be authenticated', error);
    }
    throw error;
  }
}
