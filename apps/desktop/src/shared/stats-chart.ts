import type { ChartScale } from './stats';

const TICKS = 4;

const MIN_STEP = 25;

const NICE_FACTORS = [1, 2, 2.5, 5, 10] as const;

function niceStep(raw: number): number {
  if (raw <= MIN_STEP) {
    return MIN_STEP;
  }
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const factor = NICE_FACTORS.find((candidate) => candidate * magnitude >= raw) ?? 10;
  return factor * magnitude;
}

function average(total: number, count: number): number {
  if (count === 0) {
    return 0;
  }
  return Math.round(total / count);
}

export function chartScale(values: readonly number[]): ChartScale {
  const total = values.reduce((sum, value) => sum + value, 0);
  const step = niceStep(Math.max(0, ...values) / TICKS);
  return {
    top: step * TICKS,
    ticks: Array.from({ length: TICKS + 1 }, (_unused, index) => index * step),
    total,
    average: average(total, values.length),
  };
}
