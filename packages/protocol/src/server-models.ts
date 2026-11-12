import { assertOnlyKeys, matchesRule, readNullableString, readObject, type JsonObject, type StringRule } from './json-fields';

export const MAX_MODEL_NAME_CHARS = 64;

export type ServerModels = { transcription: string | null; conditioned: string | null; languageId: string | null };

export const UNKNOWN_MODELS: ServerModels = Object.freeze({ transcription: null, conditioned: null, languageId: null });

const MODEL_ROLES = ['transcription', 'conditioned', 'languageId'] as const;
const MODEL_NAME: StringRule = { maxChars: MAX_MODEL_NAME_CHARS, printable: true };

export function isModelName(value: unknown): value is string {
  return matchesRule(value, MODEL_NAME);
}

export function readServerModels(object: JsonObject, key: string): ServerModels {
  const models = readObject(object, key);
  assertOnlyKeys(models, MODEL_ROLES);
  return {
    transcription: readNullableString(models, 'transcription', MODEL_NAME),
    conditioned: readNullableString(models, 'conditioned', MODEL_NAME),
    languageId: readNullableString(models, 'languageId', MODEL_NAME),
  };
}
