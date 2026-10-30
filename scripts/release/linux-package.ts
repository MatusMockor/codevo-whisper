export type LinuxArch = 'x64' | 'arm64';

export type LinuxPackageFormat = 'AppImage' | 'deb';

export const LINUX_PACKAGE_FORMATS: readonly LinuxPackageFormat[] = ['AppImage', 'deb'];

const ARCH_TOKENS: Record<LinuxArch, Record<LinuxPackageFormat, string>> = {
  x64: { AppImage: 'x86_64', deb: 'amd64' },
  arm64: { AppImage: 'arm64', deb: 'arm64' },
};

export function linuxPackageName(version: string, arch: LinuxArch, format: LinuxPackageFormat): string {
  return `codevo-whisper-${version}-${ARCH_TOKENS[arch][format]}-linux.${format}`;
}
