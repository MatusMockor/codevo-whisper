import { concatPcm } from '../../shared/pcm';

export const MIN_FRAME_BYTES = 640;
export const MAX_FRAME_BYTES = 32_000;

function even(bytes: number): number {
  return bytes - (bytes % 2);
}

export class AudioOutbox {
  private chunks: Uint8Array[] = [];

  append(pcm: Uint8Array): void {
    if (pcm.byteLength === 0) {
      return;
    }
    this.chunks.push(pcm);
  }

  reset(pcm: Uint8Array): void {
    this.chunks = [];
    this.append(pcm);
  }

  take(final: boolean): Uint8Array[] {
    const pending = concatPcm(this.chunks);
    this.chunks = [];
    const frames: Uint8Array[] = [];
    let offset = 0;
    while (pending.byteLength - offset >= MIN_FRAME_BYTES) {
      const size = even(Math.min(MAX_FRAME_BYTES, pending.byteLength - offset));
      frames.push(pending.subarray(offset, offset + size));
      offset += size;
    }
    const rest = pending.subarray(offset);
    if (!final) {
      this.append(rest);
      return frames;
    }
    const tail = rest.subarray(0, even(rest.byteLength));
    return tail.byteLength === 0 ? frames : [...frames, tail];
  }
}
