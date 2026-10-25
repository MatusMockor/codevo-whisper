import type { ServerStatus } from '../../shared/server';
import { Listeners } from '../helper/listeners';
import type { Logger } from '../logging/logger';
import type { RemoteFailureKind } from './remote-failure';
import type { ConnectionObserver } from './server-connector';

const UNKNOWN: ServerStatus = { kind: 'unknown' };

const STATUS_BY_FAILURE: Partial<Record<RemoteFailureKind, ServerStatus>> = {
  offline: { kind: 'offline' },
  timeout: { kind: 'offline' },
  'connection-lost': { kind: 'offline' },
  'device-unknown': { kind: 'repair-needed', reason: 'device-unknown' },
  'server-key-changed': { kind: 'repair-needed', reason: 'server-key-changed' },
  'not-paired': UNKNOWN,
};

export class ServerStatusBoard implements ConnectionObserver {
  private current: ServerStatus = UNKNOWN;
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
    const next = STATUS_BY_FAILURE[kind];
    if (next === undefined) {
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

  reset(): void {
    this.set(UNKNOWN);
  }

  onChange(listener: (status: ServerStatus) => void): () => void {
    return this.listeners.add(listener);
  }

  private set(status: ServerStatus): void {
    this.current = status;
    this.listeners.emit(status);
  }
}
