import type { ServerLanguages } from '../../shared/server-languages';
import { expectedMessage } from './expected-message';
import type { SecureConnection } from './secure-connection';
import { ServerFeatures } from './server-features';

const OUTDATED: ServerLanguages = Object.freeze({ kind: 'outdated', minVersion: ServerFeatures.languageSetsMinVersion });

export async function queryServerLanguages(connection: Pick<SecureConnection, 'send' | 'next'>, serverVersion: string, timeoutMs: number): Promise<ServerLanguages> {
  if (!ServerFeatures.of(serverVersion).languageSets) {
    return OUTDATED;
  }
  connection.send({ type: 'capabilities' });
  const { languages, models } = expectedMessage(await connection.next(timeoutMs), 'capabilities');
  return { kind: 'reported', languages, models };
}
