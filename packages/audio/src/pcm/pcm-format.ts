export const PCM_SAMPLE_RATE = 16_000;
export const PCM_BYTES_PER_SAMPLE = 2;

export function msToSamples(ms: number): number {
  return Math.round((ms * PCM_SAMPLE_RATE) / 1000);
}

export function samplesToMs(samples: number): number {
  return (samples * 1000) / PCM_SAMPLE_RATE;
}

export function decodePcm16le(bytes: Uint8Array): Int16Array {
  const samples = new Int16Array(Math.floor(bytes.byteLength / PCM_BYTES_PER_SAMPLE));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * PCM_BYTES_PER_SAMPLE, true);
  }
  return samples;
}
