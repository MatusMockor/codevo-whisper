import type { SegmentTranscriber } from '../../src/scheduling/segment-transcriber';

export class ImmediateTranscriber implements SegmentTranscriber {
  readonly lengths: number[] = [];

  constructor(private readonly textFor: (pcm: Uint8Array, call: number) => string = (pcm) => `dĺžka${pcm.byteLength}`) {}

  transcribe(pcm: Uint8Array): Promise<string> {
    this.lengths.push(pcm.byteLength);
    return Promise.resolve(this.textFor(pcm, this.lengths.length - 1));
  }
}
