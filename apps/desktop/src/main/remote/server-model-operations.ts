import type { ClientMessage, ModelOperation } from '@codevo-whisper/protocol';
import type { ServerModelOutcome } from '../../shared/server-model-catalog';
import type { Logger } from '../logging/logger';
import { expectedMessage } from './expected-message';
import { RemoteFailure } from './remote-failure';
import { queryServerCapabilities } from './server-capability-query';
import type { ReadyConnection, ServerConnector } from './server-connector';
import { ServerFeatures } from './server-features';
import type { ServerSwitch } from './server-switch';

export const MODEL_OPERATION_REPLY_MS = 35_000;

export type ServerModelOperationsDeps = {
  connector: Pick<ServerConnector, 'connect'>;
  serverSwitch: Pick<ServerSwitch, 'isEnabled'>;
  logger: Logger;
  timeoutMs: number;
  replyTimeoutMs?: number;
};

const COMMANDS: Readonly<Record<ModelOperation, (id: string) => ClientMessage>> = Object.freeze({
  download: (id) => ({ type: 'model-download', id }),
  remove: (id) => ({ type: 'model-remove', id }),
  cancel: (id) => ({ type: 'model-download-cancel', id }),
});

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ServerModelOperations {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ServerModelOperationsDeps) {}

  run(operation: ModelOperation, id: string): Promise<ServerModelOutcome> {
    const next = this.queue.then(() => this.runNow(operation, id));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async runNow(operation: ModelOperation, id: string): Promise<ServerModelOutcome> {
    if (!this.deps.serverSwitch.isEnabled()) {
      return 'unreachable';
    }
    const ready = await this.open();
    if (ready === null) {
      return 'unreachable';
    }
    try {
      return await this.operate(ready, operation, id);
    } catch (error) {
      this.deps.logger.info('The server model operation failed', describe(error));
      return 'unreachable';
    } finally {
      ready.connection.close();
    }
  }

  private async open(): Promise<ReadyConnection | null> {
    try {
      return await this.deps.connector.connect();
    } catch (error) {
      this.deps.logger.info('The server for a model operation is not reachable', describe(error));
      return null;
    }
  }

  private async operate(ready: ReadyConnection, operation: ModelOperation, id: string): Promise<ServerModelOutcome> {
    if (!ServerFeatures.of(ready.serverVersion).modelCatalog) {
      return 'unsupported';
    }
    ready.connection.send(COMMANDS[operation](id));
    const reply = expectedMessage(await ready.connection.next(this.deps.replyTimeoutMs ?? MODEL_OPERATION_REPLY_MS), 'model-operation');
    if (reply.id !== id || reply.operation !== operation) {
      throw new RemoteFailure('protocol', 'the model operation reply names another request');
    }
    await this.republish(ready);
    return reply.outcome;
  }

  private async republish(ready: ReadyConnection): Promise<void> {
    try {
      const capabilities = await queryServerCapabilities(ready.connection, ready.serverVersion, this.deps.timeoutMs);
      ready.scope.connected({ connectMs: ready.connectMs, serverVersion: ready.serverVersion, ...capabilities });
    } catch (error) {
      this.deps.logger.info('The server models could not be refreshed after an operation', describe(error));
    }
  }
}
