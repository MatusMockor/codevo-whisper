import { notReady, type EngineUnavailableReason, type Preparation, type TranscriptionEngine } from '../engines/transcription-engine';
import { RemoteDictation } from './remote-dictation';
import { asRemoteFailure, type RemoteFailureKind } from './remote-failure';
import type { ServerConnector } from './server-connector';
import type { ServerLanguageSupport } from './server-language-support';

export type RemoteEngineOptions = { finishIdleMs: number; retryBufferBytes: number; reconnectDelaysMs: readonly number[]; reconnectWindowMs: number };

export const DEFAULT_REMOTE_OPTIONS: RemoteEngineOptions = Object.freeze({
  finishIdleMs: 120_000,
  retryBufferBytes: 120 * 32_000,
  reconnectDelaysMs: Object.freeze([250, 500, 1000, 2000, 4000]),
  reconnectWindowMs: 10_000,
});

export type RemoteEngineDeps = {
  connector: Pick<ServerConnector, 'connect' | 'reconnect'>;
  languages: ServerLanguageSupport;
  options?: Partial<RemoteEngineOptions>;
};

const REASON_BY_KIND: Partial<Record<RemoteFailureKind, EngineUnavailableReason>> = {
  'not-paired': 'server-not-paired',
  'device-unknown': 'server-repair-needed',
  'server-key-changed': 'server-repair-needed',
  busy: 'server-busy',
  'storage-insecure': 'server-storage',
  disconnected: 'server-disconnected',
};

export class RemoteEngine implements TranscriptionEngine {
  readonly id = 'server' as const;
  private readonly options: RemoteEngineOptions;

  constructor(private readonly deps: RemoteEngineDeps) {
    this.options = { ...DEFAULT_REMOTE_OPTIONS, ...deps.options };
  }

  async prepare(): Promise<Preparation> {
    const language = this.deps.languages.unavailableReason();
    if (language !== null) {
      return notReady(language);
    }
    try {
      const ready = await this.deps.connector.connect();
      if (!ready.scope.isCurrent()) {
        ready.connection.close();
        return notReady('server-disconnected');
      }
      const stopWatching = ready.scope.onExpire(() => ready.connection.close());
      return {
        ready: true,
        engine: {
          id: this.id,
          start: (options) => {
            stopWatching();
            return new RemoteDictation(ready, {
              options,
              finishIdleMs: this.options.finishIdleMs,
              retryBufferBytes: this.options.retryBufferBytes,
              reconnectDelaysMs: this.options.reconnectDelaysMs,
              reconnectWindowMs: this.options.reconnectWindowMs,
              reconnect: (previous) => this.deps.connector.reconnect(previous),
            });
          },
          release: () => {
            stopWatching();
            ready.connection.close();
          },
        },
      };
    } catch (error) {
      return notReady(REASON_BY_KIND[asRemoteFailure(error, 'offline').kind] ?? 'server-offline');
    }
  }
}
