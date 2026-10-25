import { downsampleFloat32, encodePcm16le, LEVEL_INTERVAL_MS, PCM_FRAME_MS } from './pcm';

export type PcmSink = {
  frame(pcm: Uint8Array): void;
  level(rms: number): void;
};

export class PcmFramer {
  private readonly frameInput: Float32Array;
  private readonly levelWindow: number;
  private frameFill = 0;
  private levelSquares = 0;
  private levelCount = 0;

  constructor(
    private readonly inputRate: number,
    private readonly emitFrames: boolean,
    private readonly sink: PcmSink,
  ) {
    this.frameInput = new Float32Array(Math.round((inputRate * PCM_FRAME_MS) / 1000));
    this.levelWindow = Math.max(1, Math.round((inputRate * LEVEL_INTERVAL_MS) / 1000));
  }

  push(samples: Float32Array): void {
    for (const sample of samples) {
      this.measure(sample);
      this.collect(sample);
    }
  }

  flush(): Uint8Array {
    const rest = this.frameInput.subarray(0, this.frameFill);
    this.frameFill = 0;
    return encodePcm16le(downsampleFloat32(rest, this.inputRate));
  }

  private measure(sample: number): void {
    this.levelSquares += sample * sample;
    this.levelCount += 1;
    if (this.levelCount < this.levelWindow) {
      return;
    }
    this.sink.level(Math.min(1, Math.sqrt(this.levelSquares / this.levelCount)));
    this.levelSquares = 0;
    this.levelCount = 0;
  }

  private collect(sample: number): void {
    if (!this.emitFrames) {
      return;
    }
    this.frameInput[this.frameFill] = sample;
    this.frameFill += 1;
    if (this.frameFill < this.frameInput.length) {
      return;
    }
    this.sink.frame(this.flush());
  }
}
