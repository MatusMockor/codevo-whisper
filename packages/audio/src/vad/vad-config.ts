export type VadConfig = {
  frameMs: number;
  floorWindowMs: number;
  priorFloorDb: number;
  onsetRatio: number;
  releaseRatio: number;
  minOnsetMarginDb: number;
  minReleaseMarginDb: number;
  silenceDb: number;
};

export const DEFAULT_VAD_CONFIG: VadConfig = {
  frameMs: 20,
  floorWindowMs: 3000,
  priorFloorDb: -60,
  onsetRatio: 0.5,
  releaseRatio: 0.4,
  minOnsetMarginDb: 6,
  minReleaseMarginDb: 3,
  silenceDb: -100,
};

function isRatio(value: number): boolean {
  return value > 0 && value <= 1;
}

export function validateVadConfig(config: VadConfig): VadConfig {
  if (config.frameMs < 20 || config.frameMs > 30) {
    throw new RangeError(`VAD frame must be 20-30 ms, got ${config.frameMs}`);
  }
  if (config.floorWindowMs < config.frameMs) {
    throw new RangeError('VAD floor window must cover at least one frame');
  }
  if (!isRatio(config.onsetRatio) || !isRatio(config.releaseRatio) || config.releaseRatio > config.onsetRatio) {
    throw new RangeError('VAD ratios must be in (0, 1] with releaseRatio <= onsetRatio');
  }
  if (config.minReleaseMarginDb > config.minOnsetMarginDb) {
    throw new RangeError('VAD release margin must not exceed the onset margin');
  }
  return config;
}
