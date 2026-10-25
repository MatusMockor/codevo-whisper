import type { PartialConfig } from './partial-config';

export interface PartialIntervalSource {
  partialIntervalMs(): number;
}

export function partialIntervalMs(activeDevices: number, serviceMs: number | undefined, config: PartialConfig): number {
  const perDevice = Math.max(config.baseIntervalMs, (serviceMs ?? 0) / config.targetLoad);
  const interval = Math.round(Math.max(1, activeDevices) * perDevice);
  return Math.min(config.maxIntervalMs, Math.max(config.minIntervalMs, interval));
}
