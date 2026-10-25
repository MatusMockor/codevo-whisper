import { concatPcm } from '../../shared/pcm';

export type AppendOutcome = 'kept' | 'limit-reached' | 'full';

export class PcmRecording {
  private frames: Uint8Array[] = [];
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  append(pcm: Uint8Array): AppendOutcome {
    const room = this.maxBytes - this.bytes;
    if (room <= 0) {
      return 'full';
    }
    const kept = pcm.byteLength > room ? pcm.subarray(0, room) : pcm;
    this.frames.push(kept);
    this.bytes += kept.byteLength;
    return this.bytes >= this.maxBytes ? 'limit-reached' : 'kept';
  }

  take(): Uint8Array {
    const pcm = concatPcm(this.frames);
    this.clear();
    return pcm;
  }

  clear(): void {
    this.frames = [];
    this.bytes = 0;
  }
}
