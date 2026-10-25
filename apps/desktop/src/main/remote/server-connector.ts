import { beginSession, type ServerMessage } from '@codevo-whisper/protocol';
import type { PairingRepository, ServerPairing } from './pairing-repository';
import { asRemoteFailure, failureForCode, RemoteFailure, type RemoteFailureKind } from './remote-failure';
import { SecureConnection } from './secure-connection';

export type ReadyConnection = { connection: SecureConnection; serverVersion: string; connectMs: number; pairing: ServerPairing };

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

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function samePairing(current: ServerPairing, previous: ServerPairing): boolean {
  return current.deviceId === previous.deviceId && current.endpoint === previous.endpoint && sameBytes(current.serverPublicKey, previous.serverPublicKey);
}

export class ServerConnector {
  constructor(private readonly deps: ConnectorDeps) {}

  connect(): Promise<ReadyConnection> {
    return this.attempt(() => this.deps.pairings.load());
  }

  reconnect(previous: ServerPairing): Promise<ReadyConnection> {
    return this.attempt(async () => {
      const current = await this.deps.pairings.load();
      return current !== null && samePairing(current, previous) ? current : null;
    });
  }

  private async attempt(pairingSource: () => Promise<ServerPairing | null>): Promise<ReadyConnection> {
    try {
      const ready = await this.open(await pairingSource());
      this.deps.observer.connected(ready.connectMs, ready.serverVersion);
      return ready;
    } catch (error) {
      const failure = asRemoteFailure(error, 'offline');
      this.deps.observer.failed(failure.kind);
      throw failure;
    }
  }

  private async open(pairing: ServerPairing | null): Promise<ReadyConnection> {
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
