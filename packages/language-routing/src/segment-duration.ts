const BYTES_PER_MILLISECOND = (16_000 * 2) / 1_000;

export function segmentMs(pcm: Uint8Array): number {
  return pcm.byteLength / BYTES_PER_MILLISECOND;
}
