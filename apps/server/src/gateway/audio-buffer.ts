import { BYTES_PER_SECOND } from '../stt/chunk-audio';

export class AudioBuffer {
  private parts: Uint8Array[] = [];
  private bytes = 0;

  append(pcm: Uint8Array): void {
    this.parts.push(pcm);
    this.bytes += pcm.length;
  }

  seconds(): number {
    return this.bytes / BYTES_PER_SECOND;
  }

  take(): Uint8Array {
    const pcm = new Uint8Array(this.bytes);
    this.parts.reduce((offset, part) => {
      pcm.set(part, offset);
      return offset + part.length;
    }, 0);
    this.clear();
    return pcm;
  }

  clear(): void {
    this.parts = [];
    this.bytes = 0;
  }
}
