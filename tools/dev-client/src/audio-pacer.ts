const BYTES_PER_MS = 32;

export type PacedFrame = { atMs: number; pcm: Uint8Array };

export type PacingOptions = { frameMs: number; burstSeconds: number };

export function pacedFrames(pcm: Uint8Array, options: PacingOptions): PacedFrame[] {
  const frameBytes = options.frameMs * BYTES_PER_MS;
  const burstMs = options.burstSeconds * 1000;
  const frames: PacedFrame[] = [];
  for (let offset = 0; offset < pcm.length; offset += frameBytes) {
    const startMs = offset / BYTES_PER_MS;
    frames.push({ atMs: Math.max(0, startMs - burstMs), pcm: pcm.subarray(offset, offset + frameBytes) });
  }
  return frames;
}
