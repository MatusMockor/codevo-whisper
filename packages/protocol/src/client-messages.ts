import { badMessage } from './errors';
import {
  assertOnlyKeys,
  parseJsonObject,
  readChoice,
  readString,
  type JsonObject,
} from './json-fields';
import {
  IDENTIFIER_PATTERN,
  LANGUAGES,
  MAX_DEVICE_NAME_CHARS,
  MAX_IDENTIFIER_CHARS,
  MessageTag,
  type ClientMessage,
} from './message-types';
import { jsonFrame, splitTag, tagged } from './tagged-frame';

const JSON_TYPES = ['hello', 'start', 'finish', 'cancel', 'pair-request'] as const;

type JsonClientMessage = Exclude<ClientMessage, { type: 'audio' }>;

export function encodeClientMessage(message: ClientMessage): Uint8Array {
  if (message.type === 'audio') {
    return tagged(MessageTag.Audio, message.pcm);
  }
  return jsonFrame(message);
}

function decodeAudio(body: Uint8Array): ClientMessage {
  if (body.length === 0 || body.length % 2 !== 0) {
    throw badMessage('audio must contain whole PCM16 samples');
  }
  return { type: 'audio', pcm: Uint8Array.from(body) };
}

function decodeJson(object: JsonObject): JsonClientMessage {
  const type = readChoice(object, 'type', JSON_TYPES);
  if (type === 'start') {
    assertOnlyKeys(object, ['type', 'sessionId', 'language']);
    return {
      type,
      sessionId: readString(object, 'sessionId', { maxChars: MAX_IDENTIFIER_CHARS, pattern: IDENTIFIER_PATTERN }),
      language: readChoice(object, 'language', LANGUAGES),
    };
  }
  if (type === 'pair-request') {
    assertOnlyKeys(object, ['type', 'deviceName']);
    return { type, deviceName: readString(object, 'deviceName', { maxChars: MAX_DEVICE_NAME_CHARS, printable: true }) };
  }
  assertOnlyKeys(object, ['type']);
  return { type };
}

export function decodeClientMessage(frame: Uint8Array): ClientMessage {
  const { tag, body } = splitTag(frame);
  if (tag === MessageTag.Audio) {
    return decodeAudio(body);
  }
  return decodeJson(parseJsonObject(body));
}
