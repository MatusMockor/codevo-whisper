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
};

type CheckOrigin = 'user' | 'background';

const CHECKABLE: ReadonlySet<UpdatePhase['kind']> = new Set(['idle', 'available', 'error']);

const CHECK_FAILURES: Readonly<Record<CheckOrigin, string>> = {
  user: 'The update check failed',
  background: 'The background update check failed',
};

export class UpdateService {
  private phase: UpdatePhase = { kind: 'idle', checked: false };
  private running: Promise<void> | null = null;
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

  install(): InstallOutcome {
    const phase = this.phase;
    if (phase.kind !== 'ready' || this.deps.mode !== 'in-app') {
      return 'not-ready';
    }
    if (this.deps.dictation.isDictating()) {
      return 'dictation-active';
    }
    const release = this.deps.dictation.suspend();
    this.deps.logger.info('Restarting to install an update', { version: phase.version });
    this.transition({ kind: 'installing', version: phase.version });
    this.deps.updater.install().catch((error: unknown) => {
      release();
      this.deps.logger.error('The update could not be installed', error);
      this.transition({ kind: 'error', failed: 'install' });
    });
    return 'restarting';
  }

  private run(origin: CheckOrigin): Promise<void> {
    if (this.running !== null && this.phase.kind === 'checking') {
      return this.running;
    }
    if (this.deps.mode === 'unsupported' || !CHECKABLE.has(this.phase.kind)) {
      return Promise.resolve();
    }
    const running = this.execute(origin).finally(() => {
      this.running = null;
    });
    this.running = running;
    return running;
  }

  private async execute(origin: CheckOrigin): Promise<void> {
    const previous = this.phase;
    this.transition({ kind: 'checking' });
    const found = await this.find(origin);
    if (found === 'failed') {
      this.transition(origin === 'background' ? previous : { kind: 'error', failed: 'check' });
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

  private async find(origin: CheckOrigin): Promise<AvailableUpdate | null | 'failed'> {
    try {
      return await this.deps.updater.check();
    } catch (error) {
      this.deps.logger.error(CHECK_FAILURES[origin], error);
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

  private transition(phase: UpdatePhase): void {
    this.phase = phase;
    this.listeners.emit(this.status());
  }
}
