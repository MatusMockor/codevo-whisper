export { decodeClientMessage, encodeClientMessage } from './client-messages';
export {
  DICTATION_LANGUAGES,
  IDENTIFIER_PATTERN,
  LANGUAGES,
  MAX_DEVICE_NAME_CHARS,
  MAX_DICTATION_LANGUAGES,
  MAX_IDENTIFIER_CHARS,
  MAX_TEXT_CHARS,
  MessageTag,
  type ClientMessage,
  type DictationLanguage,
  type Language,
  type ServerMessage,
} from './message-types';
export { decodeServerMessage, encodeServerMessage } from './server-messages';
export { isModelName, MAX_MODEL_NAME_CHARS, UNKNOWN_MODELS, type ServerModels } from './server-models';
