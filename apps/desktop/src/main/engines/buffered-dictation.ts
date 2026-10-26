import { concatPcm } from '../../shared/pcm';
import type { EngineDictation } from './transcription-engine';

export class BufferedDictation implements EngineDictation {
  private readonly frames: Uint8Array[] = [];

  constructor(private readonly transcribe: (pcm: Uint8Array) => Promise<string>) {}

  push(pcm: Uint8Array): void {
    this.frames.push(pcm);
  }

  finish(): Promise<string> {
    return this.transcribe(concatPcm(this.frames.splice(0)));
  }
}
