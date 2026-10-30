import type { FeedRules } from './feed-rules.ts';
import { linuxFeedRules } from './linux-feed-rules.ts';
import { macFeedRules } from './mac-feed-rules.ts';

const FEED_MANIFESTS: ReadonlyMap<string, FeedRules> = new Map([
  ['latest-mac.yml', macFeedRules],
  ['latest-linux.yml', linuxFeedRules('x64')],
  ['latest-linux-arm64.yml', linuxFeedRules('arm64')],
]);

export const MANIFEST_NAMES: readonly string[] = [...FEED_MANIFESTS.keys()];

export function rulesForManifest(fileName: string): FeedRules | null {
  return FEED_MANIFESTS.get(fileName) ?? null;
}
