export type RovingSteps = Readonly<Partial<Record<string, number>>>;

export function rovingIndex(key: string, current: number, last: number, steps: RovingSteps): number | null {
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return last;
  }
  const step = steps[key];
  if (step === undefined) {
    return null;
  }
  return Math.min(last, Math.max(0, current + step));
}
