import { NoiseError } from './noise-error';

export class ByteReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) {
      throw new NoiseError('handshake message is truncated');
    }
    const chunk = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return chunk;
  }

  rest(): Uint8Array {
    const chunk = this.bytes.subarray(this.offset);
    this.offset = this.bytes.length;
    return chunk;
  }
}
