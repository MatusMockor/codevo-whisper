export const PCM_SAMPLE_RATE = 16_000;
export const PCM_BYTES_PER_SAMPLE = 2;
export const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE;
export const PCM_FRAME_MS = 100;
export const LEVEL_INTERVAL_MS = 50;

function toInt16(sample: number): number {
  const clipped = Math.max(-1, Math.min(1, sample));
  return Math.round(clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff);
}

function windowAverage(input: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let index = start; index < end; index += 1) {
    sum += input[index] ?? 0;
  }
  return sum / (end - start);
}

export function downsampleFloat32(input: Float32Array, inputRate: number): Int16Array {
  const ratio = inputRate / PCM_SAMPLE_RATE;
  const output = new Int16Array(Math.round(input.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    output[index] = toInt16(windowAverage(input, start, end));
  }
  return output;
}

export function encodePcm16le(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * PCM_BYTES_PER_SAMPLE);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => {
    view.setInt16(index * PCM_BYTES_PER_SAMPLE, sample, true);
  });
  return bytes;
}

export function concatPcm(frames: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(frames.reduce((total, frame) => total + frame.byteLength, 0));
  let offset = 0;
  for (const frame of frames) {
    joined.set(frame, offset);
    offset += frame.byteLength;
  }
  return joined;
}

export function pcmDurationMs(pcm: Uint8Array): number {
  return (pcm.byteLength / PCM_BYTES_PER_SECOND) * 1000;
}
