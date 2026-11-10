import type { ServerStatus } from '../../shared/server';
import { Listeners } from '../helper/listeners';
import type { Logger } from '../logging/logger';
import type { RemoteFailureKind } from './remote-failure';
import type { ConnectionObserver, ConnectionScope } from './server-connector';

const UNKNOWN: ServerStatus = { kind: 'unknown' };
const OFFLINE: ServerStatus = { kind: 'offline' };
const BUSY: ServerStatus = { kind: 'unavailable', reason: 'busy' };
const FAILING: ServerStatus = { kind: 'unavailable', reason: 'failed' };
const UNREADABLE: ServerStatus = { kind: 'unavailable', reason: 'storage' };

const STATUS_BY_FAILURE: Partial<Record<RemoteFailureKind, ServerStatus>> = Object.freeze({
  'not-paired': UNKNOWN,
  offline: OFFLINE,
  timeout: OFFLINE,
  'connection-lost': OFFLINE,
  'device-unknown': { kind: 'repair-needed', reason: 'device-unknown' },
  'server-key-changed': { kind: 'repair-needed', reason: 'server-key-changed' },
  busy: BUSY,
  'storage-insecure': UNREADABLE,
});

export type StatusScope = ConnectionScope & { checking(): void };

export class ServerStatusBoard implements ConnectionObserver {
  private current: ServerStatus = UNKNOWN;
  private epoch = 0;
  private readonly listeners: Listeners<ServerStatus>;
  private readonly expiry: Listeners<void>;

  constructor(logger: Logger) {
    this.listeners = new Listeners(logger, 'A server status listener failed');
    this.expiry = new Listeners(logger, 'A server connection could not be stopped');
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
      onExpire: (listener) => this.whenExpired(epoch, listener),
      checking: () => whenCurrent(() => this.checking()),
      connected: (connectMs, serverVersion) => whenCurrent(() => this.connected(connectMs, serverVersion)),
      failed: (kind) => whenCurrent(() => this.failed(kind)),
    };
  }

  invalidate(): void {
    this.epoch += 1;
    this.expiry.emit();
  }

  reset(): void {
    this.invalidate();
    this.set(UNKNOWN);
  }

  onChange(listener: (status: ServerStatus) => void): () => void {
    return this.listeners.add(listener);
  }

  private whenExpired(epoch: number, listener: () => void): () => void {
    if (epoch !== this.epoch) {
      listener();
      return () => undefined;
    }
    const remove = this.expiry.add(() => {
      remove();
      listener();
    });
    return remove;
  }

  private unresolvedCheck(): ServerStatus | null {
    return this.current.kind === 'checking' ? FAILING : null;
  }

  private set(status: ServerStatus): void {
    this.current = status;
    this.listeners.emit(status);
  }
}
