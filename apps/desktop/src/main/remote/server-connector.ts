import { beginSession, type ServerMessage } from '@codevo-whisper/protocol';
import type { PairingRepository, ServerPairing } from './pairing-repository';
import { asRemoteFailure, failureForCode, RemoteFailure, type RemoteFailureKind } from './remote-failure';
import { SecureConnection } from './secure-connection';

export type ReadyConnection = { connection: SecureConnection; serverVersion: string; connectMs: number; pairing: ServerPairing; observer: ConnectionObserver };

type OpenedConnection = Omit<ReadyConnection, 'observer'>;

export interface ConnectionObserver {
  connected(connectMs: number, serverVersion: string): void;
  failed(kind: RemoteFailureKind): void;
}

export type ConnectorDeps = {
  pairings: Pick<PairingRepository, 'load'>;
  observer: ConnectionObserver;
  scope?: () => ConnectionObserver;
  clock: () => number;
  timeoutMs: number;
  keepAliveMs?: number;
};

function readyVersion(message: ServerMessage): string {
  if (message.type === 'ready') {
    return message.serverVersion;
  }
  if (message.type === 'error') {
    throw new RemoteFailure(failureForCode(message.code), message.code);
  }
  throw new RemoteFailure('protocol', `expected ready, got ${message.type}`);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function samePairing(current: ServerPairing, previous: ServerPairing): boolean {
  return current.deviceId === previous.deviceId && current.endpoint === previous.endpoint && sameBytes(current.serverPublicKey, previous.serverPublicKey);
}

export class ServerConnector {
  constructor(private readonly deps: ConnectorDeps) {}

  connect(observer: ConnectionObserver = this.begin()): Promise<ReadyConnection> {
    return this.attempt(() => this.deps.pairings.load(), observer);
  }

  reconnect(previous: ReadyConnection): Promise<ReadyConnection> {
    return this.attempt(async () => {
      const current = await this.deps.pairings.load();
      return current !== null && samePairing(current, previous.pairing) ? current : null;
    }, previous.observer);
  }

  private begin(): ConnectionObserver {
    return this.deps.scope?.() ?? this.deps.observer;
  }

  private async attempt(pairingSource: () => Promise<ServerPairing | null>, observer: ConnectionObserver): Promise<ReadyConnection> {
    try {
      const opened = await this.open(await pairingSource());
      observer.connected(opened.connectMs, opened.serverVersion);
      return { ...opened, observer };
    } catch (error) {
      const failure = asRemoteFailure(error, 'offline');
      observer.failed(failure.kind);
      throw failure;
    }
  }

  private async open(pairing: ServerPairing | null): Promise<OpenedConnection> {
    if (pairing === null) {
      throw new RemoteFailure('not-paired', 'no server is paired');
    }
    const startedAt = this.deps.clock();
    const options = { handshakeTimeoutMs: this.deps.timeoutMs, ...(this.deps.keepAliveMs === undefined ? {} : { keepAliveMs: this.deps.keepAliveMs }) };
    const connection = await SecureConnection.open(pairing.endpoint, beginSession(pairing.deviceKey, pairing.serverPublicKey), options);
    try {
      connection.send({ type: 'hello' });
      const serverVersion = readyVersion(await connection.next(this.deps.timeoutMs));
      return { connection, serverVersion, connectMs: this.deps.clock() - startedAt, pairing };
    } catch (error) {
      connection.close();
      throw error;
    }
  }
}
