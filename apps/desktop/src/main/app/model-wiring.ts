import { app } from 'electron';
import { join } from 'node:path';
import type { LocalEngineArch } from '../engines/local-backend';
import { LocalEngine } from '../engines/local-engine';
import { resolveTranscribeBinary } from '../engines/transcribe-binary';
import type { Logger } from '../logging/logger';
import { resolveModelCatalog } from '../models/catalog-path';
import { catalogView } from '../models/catalog-view';
import { loadCatalog, type CatalogPlatform } from '../models/model-catalog';
import { ModelManager } from '../models/model-manager';
import { createWarmUp, type WarmUp } from '../models/warm-up';
import { warmUpAfterUpdate } from '../models/warm-up-after-update';
import type { SettingsStore } from '../settings/settings-store';
import type { ModelCatalogView } from '../../shared/models';
import { desktopAppRoot } from './app-root';

const MODELS_DIR = 'models';
const WARM_UP_STAMP_FILE = 'warm-up.json';

export type Models = { manager: ModelManager; engine: LocalEngine; catalog: ModelCatalogView; checkInBackground(): void };

function localArch(arch: string): LocalEngineArch {
  return arch === 'arm64' ? 'arm64' : 'x64';
}

function catalogPlatform(arch: LocalEngineArch): CatalogPlatform {
  return { os: process.platform === 'darwin' ? 'darwin' : 'linux', arch, gpu: false };
}

function checkModels(manager: ModelManager, warmUp: WarmUp, logger: Logger): Promise<void> {
  return manager.verifyReady().then(() =>
    warmUpAfterUpdate({
      file: join(app.getPath('userData'), WARM_UP_STAMP_FILE),
      appVersion: app.getVersion(),
      models: manager,
      warmUp,
      logger,
    }),
  );
}

export function createModels(settings: SettingsStore, logger: Logger): Models {
  const location = { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: desktopAppRoot() };
  const arch = localArch(process.arch);
  const binary = resolveTranscribeBinary({ ...location, arch });
  const warmUp = createWarmUp({ binary, arch });
  const catalog = loadCatalog(resolveModelCatalog(location));
  const manager = new ModelManager({
    dir: join(app.getPath('userData'), MODELS_DIR),
    catalog: catalog.models,
    settings,
    warmUp,
    logger,
  });
  return {
    manager,
    engine: new LocalEngine({ binary, models: manager, settings, arch }),
    catalog: catalogView(catalog, catalogPlatform(arch)),
    checkInBackground: () => {
      checkModels(manager, warmUp, logger).catch((error: unknown) => {
        logger.error('The background model check failed', error);
      });
    },
  };
}
