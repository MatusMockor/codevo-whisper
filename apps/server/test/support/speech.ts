const SAMPLE_RATE = 16_000;

export type SpeechOptions = { amplitude?: number; burstMs?: number; gapMs?: number; seed?: number };

function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296 - 0.5;
  };
}

export function speech(seconds: number, options: SpeechOptions = {}): Uint8Array {
  const amplitude = options.amplitude ?? 8000;
  const burstSamples = ((options.burstMs ?? 400) * SAMPLE_RATE) / 1000;
  const periodSamples = burstSamples + ((options.gapMs ?? 300) * SAMPLE_RATE) / 1000;
  const next = noise(options.seed ?? 7);
  const total = Math.round(seconds * SAMPLE_RATE);
  const pcm = new Uint8Array(total * 2);
  const view = new DataView(pcm.buffer);
  for (let index = 0; index < total; index += 1) {
    const voiced = index % periodSamples < burstSamples;
    const tone = voiced ? amplitude * Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE) : 0;
    view.setInt16(index * 2, Math.round(tone + next() * 360), true);
  }
  return pcm;
}

export function continuousSpeech(seconds: number, options: SpeechOptions = {}): Uint8Array {
  return speech(seconds, { ...options, gapMs: 100 });
}

export function peakOf(pcm: Uint8Array): number {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let peak = 0;
  for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2) {
    peak = Math.max(peak, Math.abs(view.getInt16(offset, true)));
  }
  return peak;
}
