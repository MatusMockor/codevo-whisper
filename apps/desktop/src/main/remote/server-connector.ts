import { beginSession, type ServerMessage } from '@codevo-whisper/protocol';
import type { PairingRepository } from './pairing-repository';
import { asRemoteFailure, failureForCode, RemoteFailure, type RemoteFailureKind } from './remote-failure';
import { SecureConnection } from './secure-connection';

export type ReadyConnection = { connection: SecureConnection; serverVersion: string; connectMs: number };

export interface ConnectionObserver {
  connected(connectMs: number, serverVersion: string): void;
  failed(kind: RemoteFailureKind): void;
}

export type ConnectorDeps = {
  pairings: Pick<PairingRepository, 'load'>;
  observer: ConnectionObserver;
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

export class ServerConnector {
  constructor(private readonly deps: ConnectorDeps) {}

  async connect(): Promise<ReadyConnection> {
    try {
      const ready = await this.open();
      this.deps.observer.connected(ready.connectMs, ready.serverVersion);
      return ready;
    } catch (error) {
      const failure = asRemoteFailure(error, 'offline');
      this.deps.observer.failed(failure.kind);
      throw failure;
    }
  }

  private async open(): Promise<ReadyConnection> {
    const pairing = await this.deps.pairings.load();
    if (pairing === null) {
      throw new RemoteFailure('not-paired', 'no server is paired');
    }
    const startedAt = this.deps.clock();
    const options = { handshakeTimeoutMs: this.deps.timeoutMs, ...(this.deps.keepAliveMs === undefined ? {} : { keepAliveMs: this.deps.keepAliveMs }) };
    const connection = await SecureConnection.open(pairing.endpoint, beginSession(pairing.deviceKey, pairing.serverPublicKey), options);
    try {
      connection.send({ type: 'hello' });
      const serverVersion = readyVersion(await connection.next(this.deps.timeoutMs));
      return { connection, serverVersion, connectMs: this.deps.clock() - startedAt };
    } catch (error) {
      connection.close();
      throw error;
    }
  }
}
