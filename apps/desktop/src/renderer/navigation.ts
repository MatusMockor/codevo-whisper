export type PageId = 'home' | 'server' | 'settings' | 'privacy';

export type PageDefinition = { id: PageId; label: string };

export const PAGES: readonly PageDefinition[] = [
  { id: 'home', label: 'Domov' },
  { id: 'server', label: 'Server' },
  { id: 'settings', label: 'Nastavenia' },
  { id: 'privacy', label: 'Súkromie' },
];
