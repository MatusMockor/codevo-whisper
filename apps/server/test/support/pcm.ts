export const BYTES_PER_SECOND = 32_000;

export function pcmSeconds(seconds: number, fill = 0): Uint8Array {
  return new Uint8Array(Math.round(seconds * BYTES_PER_SECOND)).fill(fill);
}
