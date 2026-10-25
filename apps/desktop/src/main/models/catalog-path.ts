import { join } from 'node:path';

export const MODEL_CATALOG_FILE = 'model-catalog.json';

export type CatalogLocation = { isPackaged: boolean; resourcesPath: string; appPath: string };

export function resolveModelCatalog(location: CatalogLocation): string {
  if (location.isPackaged) {
    return join(location.resourcesPath, MODEL_CATALOG_FILE);
  }
  return join(location.appPath, 'resources', MODEL_CATALOG_FILE);
}
