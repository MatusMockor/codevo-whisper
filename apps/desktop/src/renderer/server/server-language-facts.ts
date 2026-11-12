import { isServerDown, type PairedServerView } from '../../shared/server';
import { routesLanguages, type ServerModels } from '../../shared/server-languages';

export type ServerFact = { term: string; value: string };

const LANGUAGE_SETS = 'Výber jazykov';

const UNKNOWN = '-';

function languageModels(models: ServerModels): string {
  if (models.conditioned === null || models.languageId === null) {
    return UNKNOWN;
  }
  return `${models.conditioned} + ${models.languageId}`;
}

export function serverLanguageFacts(server: Pick<PairedServerView, 'status'>): readonly ServerFact[] {
  const { status } = server;
  if (isServerDown(status) || status.kind === 'repair-needed') {
    return [];
  }
  if (status.kind !== 'online') {
    return [{ term: LANGUAGE_SETS, value: UNKNOWN }];
  }
  if (status.languages.kind === 'outdated') {
    return [{ term: LANGUAGE_SETS, value: 'Server je zastaraný' }];
  }
  return [
    { term: LANGUAGE_SETS, value: routesLanguages(status.languages) ? 'Podporovaný' : 'Chýbajú modely' },
    { term: 'Model prepisu', value: status.languages.models.transcription ?? UNKNOWN },
    { term: 'Modely pre jazyky', value: languageModels(status.languages.models) },
  ];
}
