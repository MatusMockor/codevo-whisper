import type { ServerStatus } from '../../shared/server';
import { Listeners } from '../helper/listeners';
import type { Logger } from '../logging/logger';
import type { RemoteFailureKind } from './remote-failure';
import type { ConnectionObserver } from './server-connector';

const UNKNOWN: ServerStatus = { kind: 'unknown' };
const OFFLINE: ServerStatus = { kind: 'offline' };
const BUSY: ServerStatus = { kind: 'unavailable', reason: 'busy' };
const FAILING: ServerStatus = { kind: 'unavailable', reason: 'failed' };

const STATUS_BY_FAILURE: Partial<Record<RemoteFailureKind, ServerStatus>> = Object.freeze({
  'not-paired': UNKNOWN,
  offline: OFFLINE,
  timeout: OFFLINE,
  'connection-lost': OFFLINE,
  'device-unknown': { kind: 'repair-needed', reason: 'device-unknown' },
  'server-key-changed': { kind: 'repair-needed', reason: 'server-key-changed' },
  busy: BUSY,
});

export type StatusScope = ConnectionObserver & { isCurrent(): boolean; checking(): void };

export class ServerStatusBoard implements ConnectionObserver {
  private current: ServerStatus = UNKNOWN;
  private epoch = 0;
  private readonly listeners: Listeners<ServerStatus>;

  constructor(logger: Logger) {
    this.listeners = new Listeners(logger, 'A server status listener failed');
  }

  status(): ServerStatus {
    return this.current;
  }

  connected(connectMs: number, serverVersion: string): void {
    this.set({ kind: 'online', connectMs, serverVersion });
  }

  failed(kind: RemoteFailureKind): void {
    const next = STATUS_BY_FAILURE[kind] ?? this.unresolvedCheck();
    if (next === null) {
      return;
    }
    this.set(next);
  }

  checking(): void {
    if (this.current.kind === 'repair-needed') {
      return;
    }
    this.set({ kind: 'checking' });
  }

  scope(): StatusScope {
    const epoch = this.epoch;
    const whenCurrent = (update: () => void): void => {
      if (epoch !== this.epoch) {
        return;
      }
      update();
    };
    return {
      isCurrent: () => epoch === this.epoch,
      checking: () => whenCurrent(() => this.checking()),
      connected: (connectMs, serverVersion) => whenCurrent(() => this.connected(connectMs, serverVersion)),
      failed: (kind) => whenCurrent(() => this.failed(kind)),
    };
  }

  invalidate(): void {
    this.epoch += 1;
  }

  reset(): void {
    this.invalidate();
    this.set(UNKNOWN);
  }

  onChange(listener: (status: ServerStatus) => void): () => void {
    return this.listeners.add(listener);
  }

  private unresolvedCheck(): ServerStatus | null {
    return this.current.kind === 'checking' ? FAILING : null;
  }

  private set(status: ServerStatus): void {
    this.current = status;
    this.listeners.emit(status);
  }
}
