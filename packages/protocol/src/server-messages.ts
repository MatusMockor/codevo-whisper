import { badMessage, ERROR_CODES } from './errors';
import {
  assertOnlyKeys,
  parseJsonObject,
  readBoolean,
  readChoice,
  readIndex,
  readString,
  readText,
  type JsonObject,
} from './json-fields';
import {
  IDENTIFIER_PATTERN,
  MAX_ERROR_MESSAGE_CHARS,
  MAX_IDENTIFIER_CHARS,
  MAX_TEXT_CHARS,
  MessageTag,
  type ServerMessage,
} from './message-types';
import { jsonFrame, splitTag } from './tagged-frame';

const TYPES = ['ready', 'partial', 'final', 'done', 'flow', 'error', 'pair-result'] as const;
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

function decodeJson(object: JsonObject): ServerMessage {
  const type = readChoice(object, 'type', TYPES);
  if (type === 'ready') {
    assertOnlyKeys(object, ['type', 'serverVersion']);
    return { type, serverVersion: readString(object, 'serverVersion', { maxChars: MAX_IDENTIFIER_CHARS, printable: true }) };
  }
  if (type === 'partial') {
    assertOnlyKeys(object, ['type', 'segmentId', 'revision', 'text']);
    return {
      type,
      segmentId: readIndex(object, 'segmentId'),
      revision: readIndex(object, 'revision'),
      text: readText(object, 'text', MAX_TEXT_CHARS),
    };
  }
  if (type === 'final') {
    assertOnlyKeys(object, ['type', 'segmentId', 'text']);
    return { type, segmentId: readIndex(object, 'segmentId'), text: readText(object, 'text', MAX_TEXT_CHARS) };
  }
  if (type === 'flow') {
    assertOnlyKeys(object, ['type', 'paused']);
    return { type, paused: readBoolean(object, 'paused') };
  }
  if (type === 'error') {
    assertOnlyKeys(object, ['type', 'code', 'message']);
    return { type, code: readChoice(object, 'code', ERROR_CODES), message: readText(object, 'message', MAX_ERROR_MESSAGE_CHARS) };
  }
  if (type === 'pair-result') {
    return decodePairResult(object);
  }
  assertOnlyKeys(object, ['type']);
  return { type };
}

export function decodeServerMessage(frame: Uint8Array): ServerMessage {
  const { tag, body } = splitTag(frame);
  if (tag !== MessageTag.Json) {
    throw badMessage('unknown message tag');
  }
  return decodeJson(parseJsonObject(body));
}
