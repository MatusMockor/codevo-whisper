import type { ServerModels } from '@codevo-whisper/protocol';
import type { DictationLanguage } from './dictation-languages';

export type { ServerModels };

export type ServerLanguages = { kind: 'outdated'; minVersion: string } | { kind: 'reported'; languages: readonly DictationLanguage[]; models: ServerModels };

export type LanguageCoverage = 'covered' | 'outdated' | 'missing';

export function languageCoverage(server: ServerLanguages, selected: readonly DictationLanguage[]): LanguageCoverage {
  if (server.kind === 'outdated') {
    return 'outdated';
  }
  const offered = new Set(server.languages);
  return selected.length > 0 && selected.every((language) => offered.has(language)) ? 'covered' : 'missing';
}

export function routesLanguages(server: ServerLanguages): boolean {
  return server.kind === 'reported' && server.languages.length > 0;
}
