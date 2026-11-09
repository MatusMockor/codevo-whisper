import { fingerprint } from '@codevo-whisper/protocol';
import type { PairingEngineChange } from '../../shared/engine-routing';
import { revokeCommand, type DisconnectResult, type PairedServerView, type PairingView, type ServerView, type VaultAvailability } from '../../shared/server';
import type { EngineId } from '../../shared/settings';
import type { EngineOrderQueue, OrderDecision } from '../engines/engine-order-queue';
import { Listeners } from '../helper/listeners';
import type { Logger } from '../logging/logger';
import type { DevicePairing } from './device-pairing';
import type { PairingEngineSwitch } from './pairing-engine-switch';
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
  engineSwitch: Pick<PairingEngineSwitch, 'afterPairing'>;
  order: Pick<EngineOrderQueue, 'change'>;
  logger: Logger;
  clock?: () => number;
  linux?: boolean;
};

export const FOCUS_CHECK_INTERVAL_MS = 15_000;

const IDLE: PairingView = { kind: 'idle' };
const CANCELLED: PairingView = { kind: 'failed', failure: 'cancelled' };
const UNCHANGED: PairingEngineChange = { kind: 'unchanged' };

type PairingRun = { abort: AbortController; committed: boolean };

function withoutServer(current: readonly EngineId[]): OrderDecision<void> {
  return { order: current.includes('server') ? ['local'] : null, result: undefined };
}

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
  private pairingRun: PairingRun | null = null;
  private checking: Promise<void> | null = null;
  private lastCheckAt = Number.NEGATIVE_INFINITY;
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

  isOffline(): boolean {
    return this.deps.status.status().kind === 'offline';
  }

  onChange(listener: (view: ServerView) => void): () => void {
    return this.listeners.add(listener);
  }

  pair(token: string): void {
    this.pairingRun?.abort.abort();
    const run: PairingRun = { abort: new AbortController(), committed: false };
    this.pairingRun = run;
    void this.runPairing(token, run);
  }

  cancelPairing(): void {
    const run = this.pairingRun;
    if (run === null || run.committed) {
      return;
    }
    this.pairingRun = null;
    run.abort.abort();
    this.progress = CANCELLED;
    this.publish();
  }

  check(): Promise<void> {
    this.checking ??= this.runCheck().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  refreshOnFocus(): Promise<void> {
    if (this.now() - this.lastCheckAt <= FOCUS_CHECK_INTERVAL_MS) {
      return Promise.resolve();
    }
    return this.check();
  }

  private now(): number {
    return (this.deps.clock ?? Date.now)();
  }

  private async runCheck(): Promise<void> {
    this.lastCheckAt = this.now();
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
    this.pairingRun?.abort.abort();
    this.pairingRun = null;
    const pairing = await this.loadPairing(this.deps.vault.availability());
    await this.deps.pairings.clear();
    this.progress = IDLE;
    await this.deps.order.change(withoutServer);
    this.deps.status.reset();
    return { revokeCommand: pairing === null ? null : revokeCommand(pairing.deviceId, this.deps.linux) };
  }

  dispose(): void {
    this.pairingRun?.abort.abort();
    this.unsubscribe();
  }

  private async runPairing(token: string, run: PairingRun): Promise<void> {
    const outcome = await this.deps.pairing.pair(token, (step) => this.setProgress(run, step), run.abort.signal);
    if (outcome.kind === 'failed') {
      this.finish(run, outcome);
      return;
    }
    const engine = await this.commitPairing(run);
    if (engine === null) {
      await this.discardPairing();
      return;
    }
    if (this.pairingRun !== run) {
      return;
    }
    this.finish(run, { kind: 'paired', deviceId: outcome.deviceId, engine });
    await this.check();
  }

  private claim(run: PairingRun): boolean {
    if (this.pairingRun !== run) {
      return false;
    }
    run.committed = true;
    return true;
  }

  private commitPairing(run: PairingRun): Promise<PairingEngineChange | null> {
    return this.deps.engineSwitch.afterPairing(() => this.claim(run)).catch((error: unknown) => {
      this.deps.logger.error('The transcription engine could not be switched after pairing', error);
      return run.committed ? UNCHANGED : null;
    });
  }

  private async discardPairing(): Promise<void> {
    if (this.pairingRun !== null) {
      return;
    }
    try {
      await this.deps.pairings.clear();
    } catch (error) {
      this.deps.logger.error('The pairing of a cancelled run could not be removed', error);
    }
    this.publish();
  }

  private finish(run: PairingRun, progress: PairingView): void {
    if (this.pairingRun !== run) {
      return;
    }
    this.pairingRun = null;
    this.progress = progress;
    this.publish();
  }

  private setProgress(run: PairingRun, progress: PairingView): void {
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
