export type MacArch = 'arm64' | 'x64';

const ZIP_NAME = /-(arm64|x64)-mac\.zip$/;

export function zipArch(url: string): MacArch | null {
  const arch = ZIP_NAME.exec(url)?.[1];
  if (arch === 'arm64') {
    return 'arm64';
  }
  if (arch === 'x64' && !url.includes('arm64')) {
    return 'x64';
  }
  return null;
}
