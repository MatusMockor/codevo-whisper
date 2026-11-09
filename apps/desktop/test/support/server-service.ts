import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '../../src/main/logging/logger';
import { ActiveModelReadiness } from '../../src/main/models/local-model-readiness';
import { ModelManager } from '../../src/main/models/model-manager';
import { DevicePairing } from '../../src/main/remote/device-pairing';
import { InsecureTestVault } from '../../src/main/remote/insecure-test-vault';
import { PairingEngineSwitch } from '../../src/main/remote/pairing-engine-switch';
import { EncryptedPairingFile } from '../../src/main/remote/pairing-repository';
import type { VaultAvailability } from '../../src/main/remote/secret-vault';
import { ServerConnector } from '../../src/main/remote/server-connector';
import { ServerService } from '../../src/main/remote/server-service';
import { ServerStatusBoard } from '../../src/main/remote/server-status';
import type { SettingsStore } from '../../src/main/settings/settings-store';
import { testEntry } from '../model-fixtures';

export type ServerServiceSetup = {
  dir: string;
  settings: SettingsStore;
  models: Pick<ModelManager, 'states'>;
  logger: Logger;
  availability?: VaultAvailability;
  clock?: () => number;
  timeoutMs?: number;
};

export type ServerServiceHarness = { service: ServerService; pairings: EncryptedPairingFile; status: ServerStatusBoard; file: string };

const MODEL_BODY = 'GGUF';

export async function tinyModels(dir: string, settings: SettingsStore, logger: Logger, downloaded: boolean): Promise<ModelManager> {
  const modelsDir = join(dir, 'models');
  await mkdir(modelsDir, { recursive: true });
  if (downloaded) {
    await writeFile(join(modelsDir, 'tiny.gguf'), MODEL_BODY);
  }
  return new ModelManager({ dir: modelsDir, catalog: [testEntry('tiny', MODEL_BODY)], settings, warmUp: () => Promise.resolve(), logger });
}

export function createServerService(setup: ServerServiceSetup): ServerServiceHarness {
  const { dir, settings, models, logger } = setup;
  const timeoutMs = setup.timeoutMs ?? 2000;
  const vault = new InsecureTestVault(setup.availability ?? 'available');
  const file = join(dir, 'server-pairing.json');
  const pairings = new EncryptedPairingFile(file, vault, logger);
  const status = new ServerStatusBoard(logger);
  const connector = new ServerConnector({ pairings, observer: status, clock: Date.now, timeoutMs });
  const pairing = new DevicePairing({ pairings, vault, deviceName: () => Promise.resolve('Test Mac'), clock: Date.now, timeoutMs });
  const engineSwitch = new PairingEngineSwitch({ settings, local: new ActiveModelReadiness(models, settings) });
  const clock = setup.clock === undefined ? {} : { clock: setup.clock };
  const service = new ServerService({ pairings, vault, connector, status, pairing, engineSwitch, settings, logger, ...clock });
  return { service, pairings, status, file };
}
