export const PAGE_IDS = ['home', 'server', 'settings', 'privacy'] as const;

export type PageId = (typeof PAGE_IDS)[number];

export function isPageId(value: unknown): value is PageId {
  return PAGE_IDS.some((page) => page === value);
}
