import {
  DICTATION_LANGUAGES,
  isModelName,
  isTranscriptionModelList,
  UNKNOWN_MODELS,
  type DictationLanguage,
  type ServerModels,
  type TranscriptionModelOption,
} from '@codevo-whisper/protocol';

export type SttCapabilityReport = { languages: readonly DictationLanguage[]; models: ServerModels; transcriptionModels: readonly TranscriptionModelOption[] };

export const NO_CAPABILITIES: SttCapabilityReport = Object.freeze({ languages: Object.freeze([]), models: UNKNOWN_MODELS, transcriptionModels: Object.freeze([]) });

export interface SttCapabilities {
  capabilities(): Promise<SttCapabilityReport>;
}

type Fields = Record<string, unknown>;

function fieldsOf(value: unknown): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Fields;
}

function isDictationLanguage(value: unknown): value is DictationLanguage {
  return (DICTATION_LANGUAGES as readonly unknown[]).includes(value);
}

function languagesOf(value: unknown): readonly DictationLanguage[] {
  if (!Array.isArray(value) || new Set(value).size !== value.length || !value.every(isDictationLanguage)) {
    return [];
  }
  return [...value];
}

function modelNameOf(value: unknown): string | null {
  return isModelName(value) ? value : null;
}

function modelsOf(value: unknown): ServerModels {
  const fields = fieldsOf(value);
  return {
    transcription: modelNameOf(fields.transcription),
    conditioned: modelNameOf(fields.conditioned),
    languageId: modelNameOf(fields.languageId),
  };
}

function transcriptionModelOf(value: unknown): Fields {
  const { id, name, available, default: isDefault } = fieldsOf(value);
  return { id, name, available, default: isDefault };
}

function transcriptionModelsOf(value: unknown): readonly TranscriptionModelOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const options = value.map(transcriptionModelOf);
  return isTranscriptionModelList(options) ? options : [];
}

export function parseSttCapabilities(body: unknown): SttCapabilityReport {
  const fields = fieldsOf(body);
  return { languages: languagesOf(fields.languages), models: modelsOf(fields.models), transcriptionModels: transcriptionModelsOf(fields.transcriptionModels) };
}
