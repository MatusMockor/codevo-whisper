import type { ServerMessage } from '@codevo-whisper/protocol';
import { failureForCode, RemoteFailure } from './remote-failure';

export function expectedMessage<T extends ServerMessage['type']>(message: ServerMessage, type: T): Extract<ServerMessage, { type: T }> {
  if (message.type === type) {
    return message as Extract<ServerMessage, { type: T }>;
  }
  if (message.type === 'error') {
    throw new RemoteFailure(failureForCode(message.code), message.code);
  }
  throw new RemoteFailure('protocol', `expected ${type}, got ${message.type}`);
}
