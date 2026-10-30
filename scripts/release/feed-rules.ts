import type { UpdateManifest } from './update-manifest.ts';

export type FeedRules = {
  archs(manifest: UpdateManifest): string[];
  problems(manifest: UpdateManifest): string[];
};
