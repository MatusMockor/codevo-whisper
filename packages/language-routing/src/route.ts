import type { SupportedLanguage } from './languages';

export const ROUTES = ['auto', 'verbatim-short', 'verbatim-foreign', 'verbatim-unsure', 'conditioned-fix', 'verbatim-guard', 'conditioned'] as const;

export type Route = (typeof ROUTES)[number];

export type RoutedTranscript = { text: string; language: SupportedLanguage | null; route: Route };
