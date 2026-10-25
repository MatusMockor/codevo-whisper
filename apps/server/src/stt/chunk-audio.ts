import { ProtocolError } from '@codevo-whisper/protocol';

export const SAMPLE_RATE = 16_000;
export const BYTES_PER_SAMPLE = 2;
export const BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE;
export const MIN_CHUNK_BYTES = 640;

export function chunkAudio(pcm: Uint8Array, maxSeconds = 25): Uint8Array[] {
  if (pcm.length % BYTES_PER_SAMPLE !== 0) {
    throw new ProtocolError('bad_message', 'PCM16 audio must have an even byte length');
  }
  const chunkBytes = Math.floor(maxSeconds * SAMPLE_RATE) * BYTES_PER_SAMPLE;
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
    chunks.push(pcm.subarray(offset, offset + chunkBytes));
  }
  return chunks.filter((chunk) => chunk.length >= MIN_CHUNK_BYTES);
}
