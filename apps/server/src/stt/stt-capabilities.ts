import { DICTATION_LANGUAGES, isModelName, UNKNOWN_MODELS, type DictationLanguage, type ServerModels } from '@codevo-whisper/protocol';

export type SttCapabilityReport = { languages: readonly DictationLanguage[]; models: ServerModels };

export const NO_CAPABILITIES: SttCapabilityReport = Object.freeze({ languages: Object.freeze([]), models: UNKNOWN_MODELS });

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

export function parseSttCapabilities(body: unknown): SttCapabilityReport {
  const fields = fieldsOf(body);
  return { languages: languagesOf(fields.languages), models: modelsOf(fields.models) };
}
