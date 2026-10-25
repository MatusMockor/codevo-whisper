import { notReady, type EngineUnavailableReason, type Preparation, type TranscriptionEngine } from '../engines/transcription-engine';
import { RemoteDictation } from './remote-dictation';
import { asRemoteFailure, type RemoteFailureKind } from './remote-failure';
import type { ConnectionObserver, ServerConnector } from './server-connector';

export type RemoteEngineOptions = { finishIdleMs: number; retryBufferBytes: number };

export const DEFAULT_REMOTE_OPTIONS: RemoteEngineOptions = Object.freeze({ finishIdleMs: 30_000, retryBufferBytes: 120 * 32_000 });

export type RemoteEngineDeps = {
  connector: Pick<ServerConnector, 'connect' | 'reconnect'>;
  observer: Pick<ConnectionObserver, 'failed'>;
  options?: Partial<RemoteEngineOptions>;
};

const REASON_BY_KIND: Partial<Record<RemoteFailureKind, EngineUnavailableReason>> = {
  'not-paired': 'server-not-paired',
  'device-unknown': 'server-repair-needed',
  'server-key-changed': 'server-repair-needed',
  busy: 'server-busy',
  'storage-insecure': 'server-storage',
};

export class RemoteEngine implements TranscriptionEngine {
  readonly id = 'server' as const;
  private readonly options: RemoteEngineOptions;

  constructor(private readonly deps: RemoteEngineDeps) {
    this.options = { ...DEFAULT_REMOTE_OPTIONS, ...deps.options };
  }

  async prepare(): Promise<Preparation> {
    try {
      const ready = await this.deps.connector.connect();
      return {
        ready: true,
        engine: {
          id: this.id,
          start: (options) =>
            new RemoteDictation(ready, {
              options,
              observer: this.deps.observer,
              finishIdleMs: this.options.finishIdleMs,
              retryBufferBytes: this.options.retryBufferBytes,
              reconnect: (previous) => this.deps.connector.reconnect(previous.pairing),
            }),
          release: () => ready.connection.close(),
        },
      };
    } catch (error) {
      return notReady(REASON_BY_KIND[asRemoteFailure(error, 'offline').kind] ?? 'server-offline');
    }
  }
}
