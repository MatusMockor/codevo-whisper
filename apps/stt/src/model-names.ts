import { basename } from 'node:path';

export type ServerModels = { transcription: string; conditioned: string | null; languageId: string | null };

const MODEL_EXTENSION = '.gguf';

const KNOWN_MODELS: ReadonlyMap<string, string> = new Map([
  ['parakeet-ultra-F16.gguf', 'Parakeet Ultra (F16)'],
  ['canary-1b-v2-Q8_0.gguf', 'Canary 1B v2 (Q8)'],
  ['lang-id-voxlingua107-ecapa-Q8_0.gguf', 'VoxLingua107 (rozpoznanie jazyka)'],
]);

export function modelName(path: string): string {
  const file = basename(path);
  return KNOWN_MODELS.get(file) ?? basename(file, MODEL_EXTENSION);
}
