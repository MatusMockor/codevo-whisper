import { FeedError } from './feed-error.ts';
import type { FeedFile, UpdateManifest } from './update-manifest.ts';
import { zipArch } from './zip-arch.ts';

function uniqueByUrl(files: readonly FeedFile[]): FeedFile[] {
  const byUrl = new Map<string, FeedFile>();
  files.forEach((file) => byUrl.set(file.url, file));
  return [...byUrl.values()];
}

function latestReleaseDate(manifests: readonly UpdateManifest[]): Pick<UpdateManifest, 'releaseDate'> {
  const dates = manifests.flatMap((manifest) => (manifest.releaseDate === undefined ? [] : [manifest.releaseDate])).sort();
  const latest = dates.at(-1);
  return latest === undefined ? {} : { releaseDate: latest };
}

export function mergeMacManifests(manifests: readonly UpdateManifest[]): UpdateManifest {
  if (manifests.length < 2) {
    throw new FeedError('merge needs at least two manifests');
  }
  const versions = [...new Set(manifests.map((manifest) => manifest.version))];
  if (versions.length !== 1) {
    throw new FeedError(`version mismatch: ${versions.join(', ')}`);
  }
  const files = uniqueByUrl(manifests.flatMap((manifest) => manifest.files));
  const zips = files.filter((file) => file.url.endsWith('.zip'));
  const primary = zips.find((file) => zipArch(file.url) === 'x64') ?? zips[0];
  if (primary === undefined) {
    throw new FeedError('no zip entries, MacUpdater needs a zip');
  }
  return { version: versions[0] ?? '', files, path: primary.url, sha512: primary.sha512, ...latestReleaseDate(manifests) };
}
