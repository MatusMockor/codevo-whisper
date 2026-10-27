import { Listeners } from '../helper/listeners';
import type { Logger } from '../logging/logger';
import type { InstallOutcome, UpdateMode, UpdatePhase, UpdateStatus } from '../../shared/updates';
import type { AppUpdater, AvailableUpdate } from './app-updater';
import type { DictationGuard } from './dictation-guard';

export type UpdateServiceDeps = {
  updater: AppUpdater;
  mode: UpdateMode;
  currentVersion: string;
  dictation: DictationGuard;
  logger: Logger;
  installStallMs?: number;
};

type CheckOrigin = 'user' | 'background';

const INSTALL_STALL_MS = 120_000;

const CHECKABLE: ReadonlySet<UpdatePhase['kind']> = new Set(['idle', 'available', 'error']);

const CHECK_FAILURES: Readonly<Record<CheckOrigin, string>> = {
  user: 'The update check failed',
  background: 'The background update check failed',
};

export class UpdateService {
  private phase: UpdatePhase = { kind: 'idle', checked: false };
  private running: Promise<void> | null = null;
  private searching = false;
  private origin: CheckOrigin = 'background';
  private readonly listeners: Listeners<UpdateStatus>;

  constructor(private readonly deps: UpdateServiceDeps) {
    this.listeners = new Listeners(deps.logger, 'An update status listener failed');
  }

  status(): UpdateStatus {
    return { currentVersion: this.deps.currentVersion, mode: this.deps.mode, phase: this.phase };
  }

  onChange(listener: (status: UpdateStatus) => void): () => void {
    return this.listeners.add(listener);
  }

  check(): Promise<UpdateStatus> {
    return this.run('user').then(() => this.status());
  }

  checkInBackground(): Promise<void> {
    return this.run('background');
  }

  async install(): Promise<InstallOutcome> {
    const phase = this.phase;
    if (phase.kind !== 'ready' || this.deps.mode !== 'in-app') {
      return 'not-ready';
    }
    if (this.deps.dictation.isDictating()) {
      return 'dictation-active';
    }
    const { version } = phase;
    this.transition({ kind: 'installing', version });
    const release = await this.deps.dictation.suspend();
    this.deps.logger.info('Restarting to install an update', { version });
    const stall = setTimeout(() => this.stalled(version), this.deps.installStallMs ?? INSTALL_STALL_MS);
    this.deps.updater.install().catch((error: unknown) => {
      clearTimeout(stall);
      release();
      this.deps.logger.error('The update could not be installed', error);
      this.transition({ kind: 'error', failed: 'install' });
    });
    return 'restarting';
  }

  private run(origin: CheckOrigin): Promise<void> {
    if (this.running !== null && this.searching) {
      this.join(origin);
      return this.running;
    }
    if (this.deps.mode === 'unsupported' || !CHECKABLE.has(this.phase.kind)) {
      return Promise.resolve();
    }
    this.origin = origin;
    const running = this.execute().finally(() => {
      this.running = null;
    });
    this.running = running;
    return running;
  }

  private join(origin: CheckOrigin): void {
    if (origin !== 'user' || this.origin === 'user') {
      return;
    }
    this.origin = 'user';
    this.transition({ kind: 'checking' });
  }

  private async execute(): Promise<void> {
    if (this.origin === 'user') {
      this.transition({ kind: 'checking' });
    }
    this.searching = true;
    const found = await this.find();
    this.searching = false;
    if (found === 'failed') {
      this.failed();
      return;
    }
    if (found === null) {
      this.transition({ kind: 'idle', checked: true });
      return;
    }
    this.deps.logger.info('An update is available', { version: found.version });
    if (this.deps.mode !== 'in-app') {
      this.transition({ kind: 'available', version: found.version });
      return;
    }
    await this.download(found.version);
  }

  private failed(): void {
    if (this.origin === 'background') {
      return;
    }
    this.transition({ kind: 'error', failed: 'check' });
  }

  private async find(): Promise<AvailableUpdate | null | 'failed'> {
    try {
      return await this.deps.updater.check();
    } catch (error) {
      this.deps.logger.error(CHECK_FAILURES[this.origin], error);
      return 'failed';
    }
  }

  private async download(version: string): Promise<void> {
    this.transition({ kind: 'downloading', version, percent: 0 });
    try {
      await this.deps.updater.download((percent) => this.progress(version, percent));
      this.transition({ kind: 'ready', version });
    } catch (error) {
      this.deps.logger.error('The update download failed', error);
      this.transition({ kind: 'error', failed: 'download' });
    }
  }

  private progress(version: string, raw: number): void {
    const percent = Math.min(100, Math.max(0, Math.round(raw)));
    if (this.phase.kind !== 'downloading' || this.phase.percent === percent) {
      return;
    }
    this.transition({ kind: 'downloading', version, percent });
  }

  private stalled(version: string): void {
    if (this.phase.kind !== 'installing') {
      return;
    }
    this.deps.logger.warn('The update did not restart the app in time', { version });
    this.transition({ kind: 'stalled', version });
  }

  private transition(phase: UpdatePhase): void {
    this.phase = phase;
    this.listeners.emit(this.status());
  }
}
