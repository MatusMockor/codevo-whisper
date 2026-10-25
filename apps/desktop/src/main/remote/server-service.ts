import { fingerprint } from '@codevo-whisper/protocol';
import { revokeCommand, type DisconnectResult, type PairedServerView, type PairingView, type ServerView, type VaultAvailability } from '../../shared/server';
import type { Settings } from '../../shared/settings';
import { Listeners } from '../helper/listeners';
import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../settings/settings-store';
import type { DevicePairing } from './device-pairing';
import type { PairingRepository, ServerPairing } from './pairing-repository';
import type { SecretVault } from './secret-vault';
import type { ServerConnector } from './server-connector';
import type { ServerStatusBoard } from './server-status';

export type ServerServiceDeps = {
  pairings: PairingRepository;
  vault: Pick<SecretVault, 'availability'>;
  connector: Pick<ServerConnector, 'connect'>;
  status: ServerStatusBoard;
  pairing: Pick<DevicePairing, 'pair'>;
  settings: Pick<SettingsStore, 'get' | 'update'>;
  logger: Logger;
};

const IDLE: PairingView = { kind: 'idle' };
const LOCAL_ONLY: Settings['engineOrder'] = ['local'];

function describe(pairing: ServerPairing, status: PairedServerView['status']): PairedServerView {
  return {
    host: new URL(pairing.endpoint).host,
    endpoint: pairing.endpoint,
    deviceId: pairing.deviceId,
    deviceName: pairing.deviceName,
    pairedAt: pairing.pairedAt,
    serverFingerprint: fingerprint(pairing.serverPublicKey),
    deviceFingerprint: fingerprint(pairing.deviceKey.publicKey),
    status,
  };
}

export class ServerService {
  private progress: PairingView = IDLE;
  private pairingRun: AbortController | null = null;
  private readonly listeners: Listeners<ServerView>;
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: ServerServiceDeps) {
    this.listeners = new Listeners(deps.logger, 'A server view listener failed');
    this.unsubscribe = deps.status.onChange(() => this.publish());
  }

  async view(): Promise<ServerView> {
    const storage = this.deps.vault.availability();
    const pairing = await this.loadPairing(storage);
    return { storage, server: pairing === null ? null : describe(pairing, this.deps.status.status()), pairing: this.progress };
  }

  async isPaired(): Promise<boolean> {
    return (await this.loadPairing(this.deps.vault.availability())) !== null;
  }

  needsRepair(): boolean {
    return this.deps.status.status().kind === 'repair-needed';
  }

  onChange(listener: (view: ServerView) => void): () => void {
    return this.listeners.add(listener);
  }

  pair(token: string): void {
    this.pairingRun?.abort();
    const run = new AbortController();
    this.pairingRun = run;
    void this.runPairing(token, run);
  }

  cancelPairing(): void {
    this.pairingRun?.abort();
  }

  async check(): Promise<void> {
    if (!(await this.isPaired())) {
      this.deps.status.reset();
      return;
    }
    this.deps.status.checking();
    try {
      const ready = await this.deps.connector.connect();
      ready.connection.close();
    } catch (error) {
      this.deps.logger.info('The server check failed', error instanceof Error ? error.message : String(error));
    }
  }

  async disconnect(): Promise<DisconnectResult> {
    this.pairingRun?.abort();
    this.pairingRun = null;
    const pairing = await this.loadPairing(this.deps.vault.availability());
    await this.deps.pairings.clear();
    this.progress = IDLE;
    if (this.deps.settings.get().engineOrder.includes('server')) {
      await this.deps.settings.update({ engineOrder: LOCAL_ONLY });
    }
    this.deps.status.reset();
    return { revokeCommand: pairing === null ? null : revokeCommand(pairing.deviceId) };
  }

  dispose(): void {
    this.pairingRun?.abort();
    this.unsubscribe();
  }

  private async runPairing(token: string, run: AbortController): Promise<void> {
    const outcome = await this.deps.pairing.pair(token, (step) => this.setProgress(run, step), run.signal);
    this.setProgress(run, outcome.kind === 'failed' ? outcome : { kind: 'paired', deviceId: outcome.deviceId });
    if (this.pairingRun !== run) {
      return;
    }
    this.pairingRun = null;
    if (outcome.kind === 'paired') {
      await this.check();
    }
  }

  private setProgress(run: AbortController, progress: PairingView): void {
    if (this.pairingRun !== run) {
      return;
    }
    this.progress = progress;
    this.publish();
  }

  private async loadPairing(storage: VaultAvailability): Promise<ServerPairing | null> {
    if (storage !== 'available') {
      return null;
    }
    try {
      return await this.deps.pairings.load();
    } catch (error) {
      this.deps.logger.error('The server pairing could not be loaded', error);
      return null;
    }
  }

  private publish(): void {
    this.view()
      .then((view) => this.listeners.emit(view))
      .catch((error: unknown) => {
        this.deps.logger.error('The server view could not be built', error);
      });
  }
}
