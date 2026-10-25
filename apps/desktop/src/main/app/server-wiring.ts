import { app } from 'electron';
import { join } from 'node:path';
import type { Logger } from '../logging/logger';
import { computerName } from '../remote/computer-name';
import { DevicePairing } from '../remote/device-pairing';
import { InsecureTestVault } from '../remote/insecure-test-vault';
import { EncryptedPairingFile } from '../remote/pairing-repository';
import { RemoteEngine } from '../remote/remote-engine';
import { SafeStorageVault } from '../remote/safe-storage-vault';
import type { SecretVault } from '../remote/secret-vault';
import { ServerConnector } from '../remote/server-connector';
import { ServerService } from '../remote/server-service';
import { ServerStatusBoard } from '../remote/server-status';
import type { SettingsStore } from '../settings/settings-store';
import type { MainWindowEvents } from '../windows/main-window-controller';

const PAIRING_FILE = 'server-pairing.json';
const CONNECT_TIMEOUT_MS = 4_000;
const PAIRING_TIMEOUT_MS = 10_000;

export type ServerWiringDeps = { settings: SettingsStore; window: MainWindowEvents; e2e: boolean; logger: Logger };

export type ServerServices = { engine: RemoteEngine; service: ServerService; dispose(): void };

function vaultFor(e2e: boolean): SecretVault {
  if (e2e) {
    return new InsecureTestVault();
  }
  return new SafeStorageVault();
}

export function createServerServices({ settings, window, e2e, logger }: ServerWiringDeps): ServerServices {
  const vault = vaultFor(e2e);
  const pairings = new EncryptedPairingFile(join(app.getPath('userData'), PAIRING_FILE), vault, logger);
  const status = new ServerStatusBoard(logger);
  const connector = new ServerConnector({ pairings, observer: status, clock: Date.now, timeoutMs: CONNECT_TIMEOUT_MS });
  const pairing = new DevicePairing({ pairings, vault, deviceName: () => computerName(), clock: Date.now, timeoutMs: PAIRING_TIMEOUT_MS });
  const service = new ServerService({ pairings, vault, connector, status, pairing, settings, logger });
  const unsubscribers = [service.onChange((view) => window.send('server-changed', view)), window.onFocus(() => void service.check())];
  void service.check();
  return {
    engine: new RemoteEngine({ connector, observer: status }),
    service,
    dispose: () => {
      for (const unsubscribe of unsubscribers.splice(0)) {
        unsubscribe();
      }
      service.dispose();
    },
  };
}
