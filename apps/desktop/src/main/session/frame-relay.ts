import type { EngineDictation } from '../engines/transcription-engine';

export class FrameRelay {
  private pending: Uint8Array[] = [];
  private sink: EngineDictation | null = null;

  push(pcm: Uint8Array): void {
    if (this.sink !== null) {
      this.sink.push(pcm);
      return;
    }
    this.pending.push(pcm);
  }

  attach(sink: EngineDictation): void {
    this.sink = sink;
    for (const pcm of this.pending.splice(0)) {
      sink.push(pcm);
    }
  }

  drop(): void {
    this.pending = [];
  }
}
