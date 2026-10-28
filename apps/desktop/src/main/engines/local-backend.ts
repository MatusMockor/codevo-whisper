import type { TranscribeBackend } from '@codevo-whisper/stt-runner';
import type { LocalAcceleration } from '../../shared/settings';
import { availableParallelism } from 'node:os';

const MAX_THREADS = 4;

export type LocalEngineArch = 'arm64' | 'x64';

export function localBackend(arch: LocalEngineArch, acceleration: LocalAcceleration = 'auto', platform: NodeJS.Platform = process.platform): TranscribeBackend {
  if (platform !== 'darwin' || acceleration === 'cpu') return 'cpu';
  return acceleration === 'gpu' || arch === 'arm64' ? 'metal' : 'cpu';
}

export function localThreads(): number {
  return Math.min(MAX_THREADS, availableParallelism());
}
