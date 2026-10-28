import { join } from 'node:path';

export const WORKER_BINARY_NAME = 'cw-stt-worker';

export type TranscribeBinaryLocation = { isPackaged: boolean; resourcesPath: string; appPath: string; arch: string };

export function resolveWorkerBinary(location: TranscribeBinaryLocation): string {
  if (location.isPackaged) {
    return join(location.resourcesPath, 'bin', location.arch, WORKER_BINARY_NAME);
  }
  return join(location.appPath, 'resources', 'bin', location.arch, WORKER_BINARY_NAME);
}
