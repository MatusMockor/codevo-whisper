import type { FeedRules } from './feed-rules.ts';
import { LINUX_PACKAGE_FORMATS, linuxPackageName, type LinuxArch } from './linux-package.ts';
import type { UpdateManifest } from './update-manifest.ts';

function expectedNames(manifest: UpdateManifest, arch: LinuxArch): string[] {
  return LINUX_PACKAGE_FORMATS.map((format) => linuxPackageName(manifest.version, arch, format));
}

function countOf(manifest: UpdateManifest, name: string): number {
  return manifest.files.filter((entry) => entry.url === name).length;
}

function foreignEntries(manifest: UpdateManifest, arch: LinuxArch): string[] {
  const expected = expectedNames(manifest, arch);
  return manifest.files.filter((entry) => !expected.includes(entry.url)).map((entry) => `${entry.url}: not the ${arch} AppImage or deb of ${manifest.version}`);
}

function packageProblems(manifest: UpdateManifest, arch: LinuxArch): string[] {
  return expectedNames(manifest, arch).flatMap((name) => {
    const count = countOf(manifest, name);
    return count === 1 ? [] : [`expected one ${name} entry, found ${count}`];
  });
}

export function linuxFeedRules(arch: LinuxArch): FeedRules {
  return {
    archs: (manifest) => (packageProblems(manifest, arch).length === 0 ? [arch] : []),
    problems: (manifest) => [...foreignEntries(manifest, arch), ...packageProblems(manifest, arch)],
  };
}
