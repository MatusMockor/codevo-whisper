import { badMessage } from './errors';
import {
  assertOnlyKeys,
  parseJsonObject,
  readBoolean,
  readChoice,
  readChoiceList,
  readString,
  type JsonObject,
} from './json-fields';
import {
  DICTATION_LANGUAGES,
  IDENTIFIER_PATTERN,
  LANGUAGES,
  MAX_DEVICE_NAME_CHARS,
  MAX_DICTATION_LANGUAGES,
  MAX_IDENTIFIER_CHARS,
  MessageTag,
  type ClientMessage,
  type Language,
} from './message-types';
import { jsonFrame, splitTag, tagged } from './tagged-frame';

const JSON_TYPES = ['hello', 'capabilities', 'start', 'finish', 'cancel', 'pair-request'] as const;

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

type StartMessage = Extract<ClientMessage, { type: 'start' }>;

function readPartials(object: JsonObject): Pick<StartMessage, 'partials'> {
  if (object.partials === undefined) {
    return {};
  }
  return { partials: readBoolean(object, 'partials') };
}

function readLanguageSet(object: JsonObject, language: Language): Pick<StartMessage, 'languages'> {
  if (object.languages === undefined) {
    return {};
  }
  if (language !== 'auto') {
    throw badMessage('languages require language auto');
  }
  return { languages: readChoiceList(object, 'languages', DICTATION_LANGUAGES, { minItems: 1, maxItems: MAX_DICTATION_LANGUAGES }) };
}

function decodeStart(object: JsonObject): StartMessage {
  assertOnlyKeys(object, ['type', 'sessionId', 'language', 'partials', 'languages']);
  const language = readChoice(object, 'language', LANGUAGES);
  return {
    type: 'start',
    sessionId: readString(object, 'sessionId', { maxChars: MAX_IDENTIFIER_CHARS, pattern: IDENTIFIER_PATTERN }),
    language,
    ...readPartials(object),
    ...readLanguageSet(object, language),
  };
}

function decodeJson(object: JsonObject): JsonClientMessage {
  const type = readChoice(object, 'type', JSON_TYPES);
  if (type === 'start') {
    return decodeStart(object);
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
