import { concatPcm } from '../../shared/pcm';

export class RetryBuffer {
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  private overflowed = false;

  constructor(private readonly maxBytes: number) {}

  append(pcm: Uint8Array): void {
    if (this.overflowed) {
      return;
    }
    if (this.bytes + pcm.byteLength > this.maxBytes) {
      this.overflowed = true;
      this.chunks = [];
      this.bytes = 0;
      return;
    }
    this.chunks.push(pcm);
    this.bytes += pcm.byteLength;
  }

  canRetry(): boolean {
    return !this.overflowed;
  }

  audio(): Uint8Array {
    return concatPcm(this.chunks);
  }
}
