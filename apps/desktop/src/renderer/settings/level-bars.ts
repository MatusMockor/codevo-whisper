const FLOOR_DB = -60;

export function levelBars(rms: number, count: number): number {
  if (rms <= 0) {
    return 0;
  }
  const decibels = 20 * Math.log10(rms);
  const scaled = Math.round(((decibels - FLOOR_DB) / -FLOOR_DB) * count);
  return Math.max(0, Math.min(count, scaled));
}
