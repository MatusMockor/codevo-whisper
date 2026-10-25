import type { TranscribeBackend } from '@codevo-whisper/stt-runner';
import { availableParallelism } from 'node:os';

const MAX_THREADS = 4;

export type LocalEngineArch = 'arm64' | 'x64';

const BACKEND_BY_ARCH: Record<LocalEngineArch, TranscribeBackend> = { arm64: 'metal', x64: 'cpu' };

export function localBackend(arch: LocalEngineArch): TranscribeBackend {
  return BACKEND_BY_ARCH[arch];
}

export function localThreads(): number {
  return Math.min(MAX_THREADS, availableParallelism());
}
