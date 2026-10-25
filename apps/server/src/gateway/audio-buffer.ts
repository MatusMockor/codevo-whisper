import { BYTES_PER_SECOND } from '../stt/chunk-audio';

export const BLOCK_BYTES = 64 * 1024;

export class AudioBuffer {
  private blocks: Uint8Array[] = [];
  private usedInLast = 0;
  private total = 0;

  append(pcm: Uint8Array): void {
    let offset = 0;
    while (offset < pcm.length) {
      const block = this.writableBlock();
      const count = Math.min(BLOCK_BYTES - this.usedInLast, pcm.length - offset);
      block.set(pcm.subarray(offset, offset + count), this.usedInLast);
      this.usedInLast += count;
      offset += count;
    }
    this.total += pcm.length;
  }

  bytes(): number {
    return this.total;
  }

  seconds(): number {
    return this.total / BYTES_PER_SECOND;
  }

  blockCount(): number {
    return this.blocks.length;
  }

  take(): Uint8Array {
    const pcm = new Uint8Array(this.total);
    this.blocks.forEach((block, index) => {
      const remaining = this.total - index * BLOCK_BYTES;
      pcm.set(block.subarray(0, Math.min(BLOCK_BYTES, remaining)), index * BLOCK_BYTES);
    });
    this.clear();
    return pcm;
  }

  clear(): void {
    this.blocks = [];
    this.usedInLast = 0;
    this.total = 0;
  }

  private writableBlock(): Uint8Array {
    const last = this.blocks.at(-1);
    if (last !== undefined && this.usedInLast < BLOCK_BYTES) {
      return last;
    }
    const block = new Uint8Array(BLOCK_BYTES);
    this.blocks.push(block);
    this.usedInLast = 0;
    return block;
  }
}
