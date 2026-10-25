export type Pause = {
  startSample: number;
  endSample: number;
};

export function pauseMidpoint(pause: Pause): number {
  return Math.round((pause.startSample + pause.endSample) / 2);
}

export function pauseLength(pause: Pause): number {
  return pause.endSample - pause.startSample;
}
