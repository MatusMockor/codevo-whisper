import { isServerDown, type PairedServerView } from '../../shared/server';
import { routesLanguages, type ServerModels } from '../../shared/server-languages';
import { transcriptionModelPicker, type ModelPicker } from './transcription-model-picker';

export type ServerFact = { term: string; value: string } | { term: string; picker: ModelPicker };

const LANGUAGE_SETS = 'Výber jazykov';

const TRANSCRIPTION_MODEL = 'Model prepisu';

const LANGUAGE_MODELS = 'Modely pre jazyky';

const DETECTS_LANGUAGE = 'Nepoužívajú sa, model rozpozná jazyk sám';

const UNKNOWN = '-';

function languageModels(models: ServerModels): string {
  if (models.conditioned === null || models.languageId === null) {
    return UNKNOWN;
  }
  return `${models.conditioned} + ${models.languageId}`;
}

function modelFacts(models: ServerModels, picker: ModelPicker | null): readonly ServerFact[] {
  if (picker === null) {
    return [
      { term: TRANSCRIPTION_MODEL, value: models.transcription ?? UNKNOWN },
      { term: LANGUAGE_MODELS, value: languageModels(models) },
    ];
  }
  return [
    { term: TRANSCRIPTION_MODEL, picker },
    { term: LANGUAGE_MODELS, value: picker.routesLanguages ? languageModels(models) : DETECTS_LANGUAGE },
  ];
}

export function serverLanguageFacts(server: Pick<PairedServerView, 'status' | 'transcriptionModel'>): readonly ServerFact[] {
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
  return [{ term: LANGUAGE_SETS, value: routesLanguages(status.languages) ? 'Podporovaný' : 'Chýbajú modely' }, ...modelFacts(status.languages.models, transcriptionModelPicker(server))];
}
