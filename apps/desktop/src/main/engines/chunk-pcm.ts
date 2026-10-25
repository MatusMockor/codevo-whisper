import { PCM_BYTES_PER_SAMPLE, PCM_BYTES_PER_SECOND } from '../../shared/pcm';

export const MIN_TAIL_BYTES = 640;

function wholeSamples(bytes: number): number {
  return Math.floor(bytes / PCM_BYTES_PER_SAMPLE) * PCM_BYTES_PER_SAMPLE;
}

export function chunkPcm(pcm: Uint8Array, maxSeconds = 25): Uint8Array[] {
  const chunkBytes = Math.max(PCM_BYTES_PER_SAMPLE, wholeSamples(maxSeconds * PCM_BYTES_PER_SECOND));
  const usable = wholeSamples(pcm.byteLength);
  const chunks: Uint8Array[] = [];
  for (let start = 0; start < usable; start += chunkBytes) {
    chunks.push(pcm.subarray(start, Math.min(usable, start + chunkBytes)));
  }
  const tail = chunks.at(-1);
  if (tail !== undefined && tail.byteLength < MIN_TAIL_BYTES) {
    chunks.pop();
  }
  return chunks;
}
