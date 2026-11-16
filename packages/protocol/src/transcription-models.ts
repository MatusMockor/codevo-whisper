import { badMessage } from './errors';
import { matchesRule, type JsonObject, type StringRule } from './json-fields';
import { isModelName } from './server-models';

export const MAX_TRANSCRIPTION_MODELS = 8;
export const MAX_TRANSCRIPTION_MODEL_ID_CHARS = 64;
export const TRANSCRIPTION_MODEL_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export type TranscriptionModelOption = { id: string; name: string; available: boolean; default: boolean };

const OPTION_KEYS = ['id', 'name', 'available', 'default'];
const MODEL_ID: StringRule = { maxChars: MAX_TRANSCRIPTION_MODEL_ID_CHARS, pattern: TRANSCRIPTION_MODEL_ID_PATTERN };

export function isTranscriptionModelId(value: unknown): value is string {
  return matchesRule(value, MODEL_ID);
}

function isOption(value: unknown): value is TranscriptionModelOption {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as JsonObject;
  const exactKeys = Object.keys(fields).length === OPTION_KEYS.length && OPTION_KEYS.every((key) => key in fields);
  return exactKeys && isTranscriptionModelId(fields.id) && isModelName(fields.name) && typeof fields.available === 'boolean' && typeof fields.default === 'boolean';
}

export function isTranscriptionModelList(value: unknown): value is TranscriptionModelOption[] {
  if (!Array.isArray(value) || value.length > MAX_TRANSCRIPTION_MODELS || !value.every(isOption)) {
    return false;
  }
  const options: readonly TranscriptionModelOption[] = value;
  return new Set(options.map((option) => option.id)).size === options.length && options.filter((option) => option.default).length <= 1;
}

export function readTranscriptionModelId(object: JsonObject, key: string): string {
  const value = object[key];
  if (!isTranscriptionModelId(value)) {
    throw badMessage(`${key} is not a transcription model id`);
  }
  return value;
}

export function readTranscriptionModels(object: JsonObject, key: string): TranscriptionModelOption[] {
  const value = object[key];
  if (!isTranscriptionModelList(value)) {
    throw badMessage(`${key} is not a list of transcription models`);
  }
  return value.map((option) => ({ id: option.id, name: option.name, available: option.available, default: option.default }));
}
