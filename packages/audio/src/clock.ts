export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => performance.now(),
};
