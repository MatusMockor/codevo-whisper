import { posix } from 'node:path';

const BUNDLE_SUFFIX = '.app';

export function appBundlePath(executablePath: string): string {
  const macOsDir = posix.dirname(executablePath);
  const contentsDir = posix.dirname(macOsDir);
  const bundle = posix.dirname(contentsDir);
  if (posix.basename(macOsDir) !== 'MacOS' || posix.basename(contentsDir) !== 'Contents' || !bundle.endsWith(BUNDLE_SUFFIX)) {
    return executablePath;
  }
  return bundle;
}
