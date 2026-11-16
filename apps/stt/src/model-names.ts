import { basename } from 'node:path';
import { PINNED_FILES } from './pinned-models';

export type ServerModels = { transcription: string; conditioned: string | null; languageId: string | null };

const MODEL_EXTENSION = '.gguf';

const KNOWN_MODELS: ReadonlyMap<string, string> = new Map(PINNED_FILES.map((pinned) => [pinned.file, pinned.name]));

export function modelName(path: string): string {
  const file = basename(path);
  return KNOWN_MODELS.get(file) ?? basename(file, MODEL_EXTENSION);
}
