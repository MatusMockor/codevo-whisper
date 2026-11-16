import { join, resolve } from 'node:path';
import type { SttConfig } from './config';
import { modelName } from './model-names';
import {
  PARAKEET_ULTRA_F16,
  PARAKEET_ULTRA_Q8,
  pinnedUrl,
  WHISPER_LARGE_V3_F16,
  WHISPER_LARGE_V3_Q8,
  WHISPER_LARGE_V3_TURBO_F16,
  WHISPER_LARGE_V3_TURBO_Q8,
  type PinnedFile,
} from './pinned-models';
import { PARAKEET_ULTRA, WHISPER_LARGE_V3 } from './transcription-model';

export type ModelFamily = 'parakeet' | 'whisper';

export type CatalogModel = { id: string; name: string; family: ModelFamily; url: string; sha256: string; size: number; target: string };

export type PinnedCatalog = { primary: CatalogModel; alternatives: readonly CatalogModel[] };

export type CatalogTargets = Pick<SttConfig, 'model' | 'whisperModel' | 'modelsDir'>;

function catalogModel(id: string, family: ModelFamily, pinned: PinnedFile, target: string): CatalogModel {
  return { id, name: pinned.name, family, url: pinnedUrl(pinned), sha256: pinned.sha256, size: pinned.size, target };
}

function conflict(models: readonly CatalogModel[]): string | null {
  const owners = new Map<string, string>();
  for (const model of models) {
    const target = resolve(model.target);
    const owner = owners.get(target);
    if (owner !== undefined) {
      return `catalog model targets must be unique: ${target} is the target of both ${owner} and ${model.id}`;
    }
    owners.set(target, model.id);
  }
  return null;
}

export function catalogOf(primary: CatalogModel, alternatives: readonly CatalogModel[]): PinnedCatalog {
  const models = [primary, ...alternatives];
  if (new Set(models.map((model) => model.id)).size !== models.length) {
    throw new RangeError('catalog model ids must be unique');
  }
  const problem = conflict(models);
  if (problem !== null) {
    throw new RangeError(problem);
  }
  return { primary, alternatives };
}

export function pinnedCatalog(targets: CatalogTargets): PinnedCatalog {
  const inModels = (pinned: PinnedFile): string => join(targets.modelsDir, pinned.file);
  return catalogOf({ ...catalogModel(PARAKEET_ULTRA, 'parakeet', PARAKEET_ULTRA_F16, targets.model), name: modelName(targets.model) }, [
    catalogModel('parakeet-ultra-q8', 'parakeet', PARAKEET_ULTRA_Q8, inModels(PARAKEET_ULTRA_Q8)),
    catalogModel(WHISPER_LARGE_V3, 'whisper', WHISPER_LARGE_V3_F16, targets.whisperModel),
    catalogModel('whisper-large-v3-q8', 'whisper', WHISPER_LARGE_V3_Q8, inModels(WHISPER_LARGE_V3_Q8)),
    catalogModel('whisper-large-v3-turbo', 'whisper', WHISPER_LARGE_V3_TURBO_F16, inModels(WHISPER_LARGE_V3_TURBO_F16)),
    catalogModel('whisper-large-v3-turbo-q8', 'whisper', WHISPER_LARGE_V3_TURBO_Q8, inModels(WHISPER_LARGE_V3_TURBO_Q8)),
  ]);
}
