import { join } from 'node:path';

export const TRANSCRIBE_BINARY_NAME = 'transcribe-cli';

export type TranscribeBinaryLocation = { isPackaged: boolean; resourcesPath: string; appPath: string; arch: string };

export function resolveTranscribeBinary(location: TranscribeBinaryLocation): string {
  if (location.isPackaged) {
    return join(location.resourcesPath, 'bin', location.arch, TRANSCRIBE_BINARY_NAME);
  }
  return join(location.appPath, 'resources', 'bin', location.arch, TRANSCRIBE_BINARY_NAME);
}
