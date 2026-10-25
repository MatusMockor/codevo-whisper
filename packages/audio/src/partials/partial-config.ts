export type PartialConfig = {
  baseIntervalMs: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  targetLoad: number;
  minTailMs: number;
};

export const DEFAULT_PARTIAL_CONFIG: PartialConfig = {
  baseIntervalMs: 1000,
  minIntervalMs: 1000,
  maxIntervalMs: 3000,
  targetLoad: 0.55,
  minTailMs: 500,
};

export function validatePartialConfig(config: PartialConfig): PartialConfig {
  if (config.minIntervalMs <= 0 || config.minIntervalMs > config.maxIntervalMs) {
    throw new RangeError('Partial interval needs 0 < minIntervalMs <= maxIntervalMs');
  }
  if (config.targetLoad <= 0 || config.targetLoad > 1) {
    throw new RangeError('Partial target load must be in (0, 1]');
  }
  if (config.baseIntervalMs <= 0 || config.minTailMs < 0) {
    throw new RangeError('Partial base interval must be positive and min tail not negative');
  }
  return config;
}
