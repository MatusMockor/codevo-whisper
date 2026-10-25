import { decodePcm16le, PCM_BYTES_PER_SAMPLE } from './pcm-format';

const INITIAL_CAPACITY_BYTES = 64 * 1024;

export class PcmBuffer {
  private bytes = new Uint8Array(INITIAL_CAPACITY_BYTES);
  private usedBytes = 0;
  private firstSample = 0;
  private carry: number | undefined;

  get startSample(): number {
    return this.firstSample;
  }

  get endSample(): number {
    return this.firstSample + this.usedBytes / PCM_BYTES_PER_SAMPLE;
  }

  append(chunk: Uint8Array): Int16Array {
    const joined = this.withCarry(chunk);
    const wholeBytes = joined.byteLength - (joined.byteLength % PCM_BYTES_PER_SAMPLE);
    this.carry = wholeBytes < joined.byteLength ? joined[wholeBytes] : undefined;
    const whole = joined.subarray(0, wholeBytes);
    this.ensureCapacity(this.usedBytes + whole.byteLength);
    this.bytes.set(whole, this.usedBytes);
    this.usedBytes += whole.byteLength;
    return decodePcm16le(whole);
  }

  slice(fromSample: number, toSample: number): Uint8Array {
    if (fromSample < this.firstSample || toSample > this.endSample || fromSample > toSample) {
      throw new RangeError(`PCM range ${fromSample}-${toSample} is outside ${this.firstSample}-${this.endSample}`);
    }
    return this.bytes.slice(this.offsetOf(fromSample), this.offsetOf(toSample));
  }

  discardBefore(sample: number): void {
    const target = Math.min(Math.max(sample, this.firstSample), this.endSample);
    const dropBytes = this.offsetOf(target);
    this.bytes.copyWithin(0, dropBytes, this.usedBytes);
    this.usedBytes -= dropBytes;
    this.firstSample = target;
  }

  private offsetOf(sample: number): number {
    return (sample - this.firstSample) * PCM_BYTES_PER_SAMPLE;
  }

  private withCarry(chunk: Uint8Array): Uint8Array {
    if (this.carry === undefined) {
      return chunk;
    }
    const joined = new Uint8Array(chunk.byteLength + 1);
    joined[0] = this.carry;
    joined.set(chunk, 1);
    return joined;
  }

  private ensureCapacity(requiredBytes: number): void {
    if (requiredBytes <= this.bytes.byteLength) {
      return;
    }
    let capacity = this.bytes.byteLength;
    while (capacity < requiredBytes) {
      capacity *= 2;
    }
    const grown = new Uint8Array(capacity);
    grown.set(this.bytes.subarray(0, this.usedBytes));
    this.bytes = grown;
  }
}
