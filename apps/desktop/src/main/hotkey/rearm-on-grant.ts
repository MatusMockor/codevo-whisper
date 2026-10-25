import type { Logger } from '../logging/logger';
import type { PermissionsService } from '../permissions/permissions-service';
import type { PermissionsStatus } from '../../shared/permissions';
import type { HotkeyService } from './hotkey-service';

const FIRST_RETRY_MS = 1000;

const MAX_RETRY_MS = 60_000;

export class HotkeyRearm {
  private pending: Promise<void> | null = null;
  private failures = 0;
  private nextAttemptAt = 0;
  private readonly unsubscribe: () => void;

  constructor(
    permissions: Pick<PermissionsService, 'onRead'>,
    private readonly hotkey: Pick<HotkeyService, 'start' | 'isArmed'>,
    private readonly logger: Logger,
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.unsubscribe = permissions.onRead((status) => this.handle(status));
  }

  settled(): Promise<void> {
    return this.pending ?? Promise.resolve();
  }

  dispose(): void {
    this.unsubscribe();
  }

  private handle(status: PermissionsStatus): void {
    if (!status.inputMonitoring || this.hotkey.isArmed() || this.pending !== null || this.clock() < this.nextAttemptAt) {
      return;
    }
    this.pending = this.hotkey
      .start()
      .then(
        () => this.succeeded(),
        (error: unknown) => this.failed(error),
      )
      .finally(() => {
        this.pending = null;
      });
  }

  private succeeded(): void {
    this.failures = 0;
    this.nextAttemptAt = 0;
  }

  private failed(error: unknown): void {
    this.failures += 1;
    this.nextAttemptAt = this.clock() + Math.min(FIRST_RETRY_MS * 2 ** (this.failures - 1), MAX_RETRY_MS);
    if (this.failures > 1) {
      return;
    }
    this.logger.error('The hotkey could not start after Input Monitoring was granted, retrying with backoff', error);
  }
}
