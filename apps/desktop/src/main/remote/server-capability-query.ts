import type { ClientMessage } from '@codevo-whisper/protocol';
import type { ConnectedServer } from '../../shared/server';
import type { ServerLanguages } from '../../shared/server-languages';
import { expectedMessage } from './expected-message';
import type { SecureConnection } from './secure-connection';
import { ServerFeatures } from './server-features';

export type ServerCapabilities = Pick<ConnectedServer, 'languages' | 'transcriptionModels' | 'modelCatalog'>;

const OUTDATED_LANGUAGES: ServerLanguages = Object.freeze({ kind: 'outdated', minVersion: ServerFeatures.languageSetsMinVersion });

const OUTDATED: ServerCapabilities = Object.freeze({ languages: OUTDATED_LANGUAGES, transcriptionModels: Object.freeze([]), modelCatalog: null });

function capabilityRequest(features: ServerFeatures): ClientMessage {
  if (features.modelCatalog) {
    return { type: 'capabilities', transcriptionModels: true, modelCatalog: true };
  }
  if (!features.transcriptionModels) {
    return { type: 'capabilities' };
  }
  return { type: 'capabilities', transcriptionModels: true };
}

export async function queryServerCapabilities(connection: Pick<SecureConnection, 'send' | 'next'>, serverVersion: string, timeoutMs: number): Promise<ServerCapabilities> {
  const features = ServerFeatures.of(serverVersion);
  if (!features.languageSets) {
    return OUTDATED;
  }
  connection.send(capabilityRequest(features));
  const { languages, models, transcriptionModels = [], modelCatalog = null } = expectedMessage(await connection.next(timeoutMs), 'capabilities');
  return { languages: { kind: 'reported', languages, models }, transcriptionModels, modelCatalog };
}
