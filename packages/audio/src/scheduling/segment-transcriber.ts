export interface SegmentTranscriber {
  transcribe(pcm: Uint8Array, signal: AbortSignal): Promise<string>;
}
