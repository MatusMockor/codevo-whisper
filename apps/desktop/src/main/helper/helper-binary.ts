import { join } from 'node:path';

export const HELPER_BINARY_NAME = 'codevo-input-helper';

export type HelperBinaryLocation = {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  arch: string;
};

export function resolveHelperBinary(location: HelperBinaryLocation): string {
  if (location.isPackaged) {
    return join(location.resourcesPath, 'bin', location.arch, HELPER_BINARY_NAME);
  }
  return join(location.appPath, '..', '..', 'native', 'macos-helper', 'build', location.arch, HELPER_BINARY_NAME);
}
