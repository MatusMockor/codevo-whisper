import { msToSamples, PCM_SAMPLE_RATE } from '../../src/pcm/pcm-format';

export function silence(ms: number): Int16Array {
  return new Int16Array(msToSamples(ms));
}

export function tone(ms: number, amplitude: number, hz = 220): Int16Array {
  const samples = new Int16Array(msToSamples(ms));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.round(amplitude * Math.sin((2 * Math.PI * hz * index) / PCM_SAMPLE_RATE));
  }
  return samples;
}

export function addWhiteNoise(samples: Int16Array, rmsAmplitude: number, seed: number): Int16Array {
  const noisy = new Int16Array(samples.length);
  let state = seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296 - 0.5;
  };
  for (let index = 0; index < samples.length; index += 1) {
    const gaussianish = next() + next() + next() + next();
    const value = (samples[index] ?? 0) + gaussianish * Math.sqrt(3) * rmsAmplitude;
    noisy[index] = Math.max(-32768, Math.min(32767, Math.round(value)));
  }
  return noisy;
}
