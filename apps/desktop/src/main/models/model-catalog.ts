import { readFileSync } from 'node:fs';
import type { LanguageHint } from '../../shared/models';
import { CatalogError } from './catalog-error';
import type { CatalogDefaults, CatalogEntry, CatalogSource, PlatformKey } from './catalog-entry';
import { parseCatalog } from './parse-catalog';

export type CatalogPlatform = { os: 'darwin' | 'linux'; arch: 'arm64' | 'x64'; gpu: boolean };

export function huggingFaceUrl(source: CatalogSource): string {
  return `https://huggingface.co/${source.repo}/resolve/${source.revision}/${source.file}`;
}

function platformKey(platform: CatalogPlatform): PlatformKey {
  if (platform.os === 'darwin') {
    return `darwin-${platform.arch}`;
  }
  return platform.gpu ? 'linux-vulkan' : 'linux-cpu';
}

export class ModelCatalog {
  constructor(
    readonly models: readonly CatalogEntry[],
    private readonly defaults: CatalogDefaults,
  ) {}

  defaultModelId(platform: CatalogPlatform): string {
    return this.defaults[platformKey(platform)].model;
  }

  languageHint(id: string): LanguageHint {
    const entry = this.models.find((model) => model.id === id);
    if (entry === undefined) {
      throw new CatalogError(`Unknown model ${id}`);
    }
    return entry.languageHint;
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new CatalogError(`Model catalog ${file} could not be read: ${String(error)}`);
  }
}

export function loadCatalog(file: string): ModelCatalog {
  const { models, defaults } = parseCatalog(readJson(file));
  return new ModelCatalog(models, defaults);
}
