import { isPageId, type PageId } from '../shared/pages';
import type { SectionId } from '../shared/section-focus';
import type { SettingId } from './settings/settings-catalog';

export type { PageId, SectionId };

export type PageDefinition = { id: PageId; label: string; title: string; lead?: string };

export const PAGES: readonly PageDefinition[] = [
  { id: 'home', label: 'Domov', title: 'Signálna cesta diktovania' },
  {
    id: 'meetings',
    label: 'Stretnutia',
    title: 'Nahrávanie a prepis stretnutí',
    lead: 'Mikrofón a zvuk systému ako dve stopy. Prepis beží lokálne a ostáva na tomto počítači.',
  },
  {
    id: 'transcription',
    label: 'Prepis',
    title: 'Kde beží prepis',
    lead: 'Server, lokálny model a ich poradie na jednom mieste. Výber platí od ďalšieho diktovania, nikdy sa nemení počas neho.',
  },
  { id: 'settings', label: 'Nastavenia', title: 'Nastavenia' },
  {
    id: 'privacy',
    label: 'Súkromie',
    title: 'Kam putuje váš hlas',
    lead: 'V lokálnom režime sa reč prepisuje priamo na tomto počítači. Na internet ide iba stiahnutie modelu, keď kliknete na Stiahnuť, a kontrola aktualizácií.',
  },
];

export type NavTarget = { page: PageId; section?: SectionId; setting?: SettingId };

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

export const AI_SECTION: NavTarget = Object.freeze({ page: 'settings', section: 'ai' });

export const MICROPHONE_SECTION: NavTarget = Object.freeze({ page: 'settings', section: 'microphone' });
