import { join } from 'node:path';

export const WORKER_BINARY_NAME = 'cw-stt-worker';

export type TranscribeBinaryLocation = { isPackaged: boolean; resourcesPath: string; appPath: string; arch: string; variant?: 'cpu' | 'vulkan' };

export function resolveWorkerBinary(location: TranscribeBinaryLocation): string {
  const name = location.variant === 'vulkan' ? `${WORKER_BINARY_NAME}-vulkan` : WORKER_BINARY_NAME;
  if (location.isPackaged) {
    return join(location.resourcesPath, 'bin', location.arch, name);
  }
  return join(location.appPath, 'resources', 'bin', location.arch, name);
}
