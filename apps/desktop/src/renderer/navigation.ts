import { isPageId, type PageId } from '../shared/pages';

export type { PageId };

export type PageDefinition = { id: PageId; label: string };

export const PAGES: readonly PageDefinition[] = [
  { id: 'home', label: 'Domov' },
  { id: 'server', label: 'Server' },
  { id: 'settings', label: 'Nastavenia' },
  { id: 'privacy', label: 'Súkromie' },
];

export function pageFromHash(hash: string): PageId {
  const page = hash.replace(/^#/, '');
  return isPageId(page) ? page : 'home';
}
