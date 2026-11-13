import { app, BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import { homedir, totalmem } from 'node:os';
import { join } from 'node:path';
import type { LocalEngineArch } from '../engines/local-backend';
import { LocalEngine } from '../engines/local-engine';
import { resolveWorkerBinary } from '../engines/transcribe-binary';
import type { Logger } from '../logging/logger';
import { resolveModelCatalog } from '../models/catalog-path';
import { catalogView } from '../models/catalog-view';
import { createDiarizer, type Diarizer } from '../models/diarizer';
import { existingLocations } from '../models/existing-models';
import { createLanguagePack, languagePackMemory, type LanguagePack } from '../models/language-pack';
import { loadCatalog, type CatalogPlatform } from '../models/model-catalog';
import { ModelManager } from '../models/model-manager';
import type { WarmUp } from '../models/warm-up';
import { warmUpAfterUpdate } from '../models/warm-up-after-update';
import type { SettingsStore } from '../settings/settings-store';
import type { ModelCatalogView } from '../../shared/models';
import { desktopAppRoot } from './app-root';

const MODELS_DIR = 'models';
const WARM_UP_STAMP_FILE = 'warm-up.json';

export type Models = { manager: ModelManager; engine: LocalEngine; catalog: ModelCatalogView; diarizer: Diarizer; languagePack: LanguagePack; checkInBackground(): void; dispose(): Promise<void> };

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

export async function pickModelFile(): Promise<string | null> {
  const options: OpenDialogOptions = {
    properties: ['openFile'],
    filters: [
      { name: 'GGUF', extensions: ['gguf'] },
      { name: 'Všetky súbory', extensions: ['*'] },
    ],
  };
  const parent = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = parent === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(parent, options);
  return canceled ? null : (filePaths[0] ?? null);
}

export function createModels(settings: SettingsStore, logger: Logger): Models {
  const location = { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: desktopAppRoot() };
  const arch = localArch(process.arch);
  const binary = resolveWorkerBinary({ ...location, arch });
  const warmUp: WarmUp = (modelPath) => engine.warmUp(modelPath);
  const catalog = loadCatalog(resolveModelCatalog(location));
  const dir = join(app.getPath('userData'), MODELS_DIR);
  const existing = existingLocations(process.env, homedir(), process.platform);
  const manager = new ModelManager({
    dir,
    catalog: catalog.models,
    settings,
    warmUp,
    logger,
    existing,
  });
  const conditioned = catalog.conditionedModel();
  const languagePack = createLanguagePack({
    dir,
    conditioned,
    languageId: catalog.languageId,
    models: manager,
    requiredRamBytes: languagePackMemory(catalog.models, conditioned, catalog.languageId),
    totalMemory: totalmem,
    settings,
    logger,
    existing,
  });
  const engine = new LocalEngine({ binary, acceleratorBinary: resolveWorkerBinary({ ...location, arch, variant: 'vulkan' }), models: manager, languagePack, settings, arch });
  return {
    manager,
    engine,
    dispose: () => engine.dispose(),
    catalog: catalogView(catalog, catalogPlatform(arch)),
    diarizer: createDiarizer({ dir, entry: catalog.diarizer, settings, logger, existing }),
    languagePack,
    checkInBackground: () => {
      checkModels(manager, warmUp, logger).catch((error: unknown) => {
        logger.error('The background model check failed', error);
      });
    },
  };
}
