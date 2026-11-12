import { badMessage, ERROR_CODES } from './errors';
import {
  assertOnlyKeys,
  parseJsonObject,
  readBoolean,
  readChoice,
  readChoiceList,
  readIndex,
  readNullableChoice,
  readString,
  readText,
  type JsonObject,
} from './json-fields';
import {
  DICTATION_LANGUAGES,
  IDENTIFIER_PATTERN,
  MAX_ERROR_MESSAGE_CHARS,
  MAX_IDENTIFIER_CHARS,
  MAX_TEXT_CHARS,
  MessageTag,
  type ServerMessage,
} from './message-types';
import { jsonFrame, splitTag } from './tagged-frame';

const TYPES = ['ready', 'capabilities', 'partial', 'final', 'done', 'flow', 'error', 'pair-result'] as const;
const PAIR_STATUSES = ['approved', 'rejected'] as const;
const IDENTIFIER = { maxChars: MAX_IDENTIFIER_CHARS, pattern: IDENTIFIER_PATTERN };

export function encodeServerMessage(message: ServerMessage): Uint8Array {
  return jsonFrame(message);
}

function decodePairResult(object: JsonObject): ServerMessage {
  const status = readChoice(object, 'status', PAIR_STATUSES);
  if (status === 'rejected') {
    assertOnlyKeys(object, ['type', 'status']);
    return { type: 'pair-result', status };
  }
  assertOnlyKeys(object, ['type', 'status', 'deviceId']);
  return { type: 'pair-result', status, deviceId: readString(object, 'deviceId', IDENTIFIER) };
}

type DetectedLanguage = Pick<Extract<ServerMessage, { type: 'final' }>, 'language'>;

function readDetectedLanguage(object: JsonObject): DetectedLanguage {
  if (object.language === undefined) {
    return {};
  }
  return { language: readNullableChoice(object, 'language', DICTATION_LANGUAGES) };
}

function decodeCapabilities(object: JsonObject): ServerMessage {
  assertOnlyKeys(object, ['type', 'languages']);
  return {
    type: 'capabilities',
    languages: readChoiceList(object, 'languages', DICTATION_LANGUAGES, { minItems: 0, maxItems: DICTATION_LANGUAGES.length }),
  };
}

function decodeError(object: JsonObject): ServerMessage {
  assertOnlyKeys(object, ['type', 'code', 'message', 'sessionId']);
  const code = readChoice(object, 'code', ERROR_CODES);
  const message = readText(object, 'message', MAX_ERROR_MESSAGE_CHARS);
  if (object.sessionId === undefined) {
    return { type: 'error', code, message };
  }
  return { type: 'error', code, message, sessionId: readString(object, 'sessionId', IDENTIFIER) };
}

function decodeJson(object: JsonObject): ServerMessage {
  const type = readChoice(object, 'type', TYPES);
  if (type === 'ready') {
    assertOnlyKeys(object, ['type', 'serverVersion']);
    return { type, serverVersion: readString(object, 'serverVersion', { maxChars: MAX_IDENTIFIER_CHARS, printable: true }) };
  }
  if (type === 'capabilities') {
    return decodeCapabilities(object);
  }
  if (type === 'partial') {
    assertOnlyKeys(object, ['type', 'sessionId', 'segmentId', 'revision', 'text', 'language']);
    return {
      type,
      sessionId: readString(object, 'sessionId', IDENTIFIER),
      segmentId: readIndex(object, 'segmentId'),
      revision: readIndex(object, 'revision'),
      text: readText(object, 'text', MAX_TEXT_CHARS),
      ...readDetectedLanguage(object),
    };
  }
  if (type === 'final') {
    assertOnlyKeys(object, ['type', 'sessionId', 'segmentId', 'text', 'language']);
    return {
      type,
      sessionId: readString(object, 'sessionId', IDENTIFIER),
      segmentId: readIndex(object, 'segmentId'),
      text: readText(object, 'text', MAX_TEXT_CHARS),
      ...readDetectedLanguage(object),
    };
  }
  if (type === 'flow') {
    assertOnlyKeys(object, ['type', 'paused']);
    return { type, paused: readBoolean(object, 'paused') };
  }
  if (type === 'error') {
    return decodeError(object);
  }
  if (type === 'done') {
    assertOnlyKeys(object, ['type', 'sessionId']);
    return { type, sessionId: readString(object, 'sessionId', IDENTIFIER) };
  }
  if (type === 'pair-result') {
    return decodePairResult(object);
  }
  throw badMessage('unknown server message type');
}

export function decodeServerMessage(frame: Uint8Array): ServerMessage {
  const { tag, body } = splitTag(frame);
  if (tag !== MessageTag.Json) {
    throw badMessage('unknown message tag');
  }
  return decodeJson(parseJsonObject(body));
}
