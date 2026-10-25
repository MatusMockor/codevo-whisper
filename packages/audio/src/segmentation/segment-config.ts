export type SegmentConfig = {
  targetMs: number;
  hardMs: number;
  minSegmentMs: number;
  overlapMs: number;
  preRollMs: number;
  minPauseMs: number;
  settledPauseMs: number;
};

export const DEFAULT_SEGMENT_CONFIG: SegmentConfig = {
  targetMs: 15000,
  hardMs: 25000,
  minSegmentMs: 10000,
  overlapMs: 1000,
  preRollMs: 500,
  minPauseMs: 200,
  settledPauseMs: 500,
};

export function validateSegmentConfig(config: SegmentConfig): SegmentConfig {
  if (config.minPauseMs <= 0 || config.settledPauseMs < config.minPauseMs) {
    throw new RangeError('Segment pauses need 0 < minPauseMs <= settledPauseMs');
  }
  if (Math.max(config.overlapMs, config.preRollMs) >= config.minSegmentMs) {
    throw new RangeError('Segment overlap and pre-roll must be shorter than minSegmentMs');
  }
  if (config.minSegmentMs > config.targetMs || config.targetMs >= config.hardMs) {
    throw new RangeError('Segment limits need minSegmentMs <= targetMs < hardMs');
  }
  return config;
}
