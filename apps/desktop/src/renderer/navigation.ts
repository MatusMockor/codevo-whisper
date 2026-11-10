import { isPageId, type PageId } from '../shared/pages';
import type { SectionId } from '../shared/section-focus';

export type { PageId, SectionId };

export type PageDefinition = { id: PageId; label: string; title: string; lead?: string };

export const PAGES: readonly PageDefinition[] = [
  { id: 'home', label: 'Domov', title: 'Signálna cesta diktovania' },
  { id: 'meetings', label: 'Stretnutia', title: 'Stretnutia' },
  {
    id: 'transcription',
    label: 'Prepis',
    title: 'Kde beží prepis',
    lead: 'Server, lokálny model a ich poradie na jednom mieste. Výber platí od ďalšieho diktovania, nikdy sa nemení počas neho.',
  },
  { id: 'settings', label: 'Nastavenia', title: 'Nastavenia' },
  { id: 'privacy', label: 'Súkromie', title: 'Súkromie' },
];

export type NavTarget = { page: PageId; section?: SectionId };

export function pageFromHash(hash: string): PageId {
  const page = hash.replace(/^#/, '');
  return isPageId(page) ? page : 'home';
}

export function pageDefinition(page: PageId): PageDefinition {
  return PAGES.find((definition) => definition.id === page) ?? { id: page, label: '', title: '' };
}

export const SERVER_SECTION: NavTarget = Object.freeze({ page: 'transcription', section: 'server' });

export const ENGINE_SECTION: NavTarget = Object.freeze({ page: 'transcription', section: 'engine' });

export const MODEL_SECTION: NavTarget = Object.freeze({ page: 'transcription', section: 'local-model' });
