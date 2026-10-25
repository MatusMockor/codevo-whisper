import type { Logger } from '../logging/logger';

export type DictationSummary = { deviceId: string; audioSeconds: number; chunks: number; durationMs: number; result: string };

export function logDictation(logger: Logger, summary: DictationSummary): void {
  logger.info('dictation', { ...summary, audioSeconds: Math.round(summary.audioSeconds * 10) / 10 });
}
