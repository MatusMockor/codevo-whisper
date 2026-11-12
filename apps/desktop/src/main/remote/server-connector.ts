import { beginSession } from '@codevo-whisper/protocol';
import type { ConnectedServer } from '../../shared/server';
import { expectedMessage } from './expected-message';
import type { PairingRepository, ServerPairing } from './pairing-repository';
import { asRemoteFailure, RemoteFailure, type RemoteFailureKind } from './remote-failure';
import { SecureConnection } from './secure-connection';
import { queryServerLanguages } from './server-language-query';

export type ReadyConnection = ConnectedServer & { connection: SecureConnection; pairing: ServerPairing; scope: ConnectionScope };

type OpenedConnection = Omit<ReadyConnection, 'scope'>;

export interface ConnectionObserver {
  connected(server: ConnectedServer): void;
  failed(kind: RemoteFailureKind): void;
}

export interface ConnectionScope extends ConnectionObserver {
  isCurrent(): boolean;
  onExpire(listener: () => void): () => void;
}

export type ConnectorDeps = {
  pairings: Pick<PairingRepository, 'load'>;
  observer: ConnectionObserver;
  scope?: () => ConnectionScope;
  clock: () => number;
  timeoutMs: number;
  keepAliveMs?: number;
};

function lasting(observer: ConnectionObserver): ConnectionScope {
  return {
    connected: (server) => observer.connected(server),
    failed: (kind) => observer.failed(kind),
    isCurrent: () => true,
    onExpire: () => () => undefined,
  };
}

function disconnected(): RemoteFailure {
  return new RemoteFailure('disconnected', 'the server was disconnected or its pairing changed');
}

function assertCurrent(scope: ConnectionScope): void {
  if (scope.isCurrent()) {
    return;
  }
  throw disconnected();
}

function failureIn(scope: ConnectionScope, error: unknown): RemoteFailure {
  if (!scope.isCurrent()) {
    return disconnected();
  }
  return asRemoteFailure(error, 'offline');
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function samePairing(current: ServerPairing, previous: ServerPairing): boolean {
  return current.deviceId === previous.deviceId && current.endpoint === previous.endpoint && sameBytes(current.serverPublicKey, previous.serverPublicKey);
}

export class ServerConnector {
  constructor(private readonly deps: ConnectorDeps) {}

  connect(scope: ConnectionScope = this.begin()): Promise<ReadyConnection> {
    return this.attempt(() => this.deps.pairings.load(), scope);
  }

  reconnect(previous: ReadyConnection): Promise<ReadyConnection> {
    return this.attempt(async () => {
      const current = await this.deps.pairings.load();
      return current !== null && samePairing(current, previous.pairing) ? current : null;
    }, previous.scope);
  }

  private begin(): ConnectionScope {
    return this.deps.scope?.() ?? lasting(this.deps.observer);
  }

  private async attempt(pairingSource: () => Promise<ServerPairing | null>, scope: ConnectionScope): Promise<ReadyConnection> {
    const cancel = new AbortController();
    const stopWatching = scope.onExpire(() => cancel.abort());
    try {
      assertCurrent(scope);
      const pairing = await pairingSource();
      assertCurrent(scope);
      const opened = await this.open(pairing, cancel.signal);
      this.keepIfCurrent(opened, scope);
      scope.connected({ connectMs: opened.connectMs, serverVersion: opened.serverVersion, languages: opened.languages });
      return { ...opened, scope };
    } catch (error) {
      const failure = failureIn(scope, error);
      scope.failed(failure.kind);
      throw failure;
    } finally {
      stopWatching();
    }
  }

  private keepIfCurrent(opened: OpenedConnection, scope: ConnectionScope): void {
    if (scope.isCurrent()) {
      return;
    }
    opened.connection.close();
    assertCurrent(scope);
  }

  private async open(pairing: ServerPairing | null, signal: AbortSignal): Promise<OpenedConnection> {
    if (pairing === null) {
      throw new RemoteFailure('not-paired', 'no server is paired');
    }
    const startedAt = this.deps.clock();
    const options = { handshakeTimeoutMs: this.deps.timeoutMs, signal, ...(this.deps.keepAliveMs === undefined ? {} : { keepAliveMs: this.deps.keepAliveMs }) };
    const connection = await SecureConnection.open(pairing.endpoint, beginSession(pairing.deviceKey, pairing.serverPublicKey), options);
    const close = (): void => connection.close();
    signal.addEventListener('abort', close, { once: true });
    try {
      connection.send({ type: 'hello' });
      const { serverVersion } = expectedMessage(await connection.next(this.deps.timeoutMs), 'ready');
      const connectMs = this.deps.clock() - startedAt;
      const languages = await queryServerLanguages(connection, serverVersion, this.deps.timeoutMs);
      return { connection, serverVersion, connectMs, languages, pairing };
    } catch (error) {
      connection.close();
      throw error;
    } finally {
      signal.removeEventListener('abort', close);
    }
  }
}
