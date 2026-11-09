import { isPageId, type PageId } from '../shared/pages';
import type { SettingsSection } from '../shared/settings-focus';

export type { PageId, SettingsSection };

export type PageDefinition = { id: PageId; label: string; title: string };

export const PAGES: readonly PageDefinition[] = [
  { id: 'home', label: 'Domov', title: 'Signálna cesta diktovania' },
  { id: 'meetings', label: 'Stretnutia', title: 'Stretnutia' },
  { id: 'server', label: 'Server', title: 'Server' },
  { id: 'settings', label: 'Nastavenia', title: 'Nastavenia' },
  { id: 'privacy', label: 'Súkromie', title: 'Súkromie' },
];

export type NavTarget = { page: PageId; section?: SettingsSection };

export function pageFromHash(hash: string): PageId {
  const page = hash.replace(/^#/, '');
  return isPageId(page) ? page : 'home';
}

export function pageDefinition(page: PageId): PageDefinition {
  return PAGES.find((definition) => definition.id === page) ?? { id: page, label: '', title: '' };
}
