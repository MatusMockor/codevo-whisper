const FULL_SCALE_SQUARED = 32768 * 32768;

export function frameEnergyDb(samples: Int16Array, from: number, to: number, silenceDb: number): number {
  let sum = 0;
  for (let index = from; index < to; index += 1) {
    const sample = samples[index] ?? 0;
    sum += sample * sample;
  }
  const meanSquare = sum / Math.max(1, to - from);
  if (meanSquare === 0) {
    return silenceDb;
  }
  return Math.max(silenceDb, 10 * Math.log10(meanSquare / FULL_SCALE_SQUARED));
}
