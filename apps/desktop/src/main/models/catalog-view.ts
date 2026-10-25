import type { ModelCatalogView, ModelInfo } from '../../shared/models';
import type { CatalogEntry } from './catalog-entry';
import type { CatalogPlatform, ModelCatalog } from './model-catalog';

function modelInfo(entry: CatalogEntry): ModelInfo {
  return {
    id: entry.id,
    name: entry.name,
    quantization: entry.quantization,
    sizeBytes: entry.sizeBytes,
    license: entry.license,
    licenseUrl: entry.licenseUrl,
    languageHint: entry.languageHint,
    roleLabels: [...entry.roleLabels],
  };
}

export function catalogView(catalog: ModelCatalog, platform: CatalogPlatform): ModelCatalogView {
  return { models: catalog.models.map(modelInfo), defaultModelId: catalog.defaultModelId(platform) };
}
