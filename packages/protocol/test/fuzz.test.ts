import fc from 'fast-check';
import { describe, it } from 'vitest';
import { ProtocolError } from '../src/errors';
import { decodeOpeningFrame } from '../src/framing';
import {
  DICTATION_LANGUAGES,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  isModelName,
  MAX_DICTATION_LANGUAGES,
  MAX_MODEL_NAME_CHARS,
  MessageTag,
  UNKNOWN_MODELS,
  type ClientMessage,
  type ServerMessage,
} from '../src/messages';
import { parsePairingToken } from '../src/pairing';

const RUNS = 10_000;

function onlyProtocolErrors<T>(decode: (input: T) => unknown): (input: T) => boolean {
  return (input) => {
    try {
      decode(input);
      return true;
    } catch (error) {
      return error instanceof ProtocolError && error.code === 'bad_message';
    }
  };
}

const randomBytes = fc.uint8Array({ maxLength: 512 });

function jsonFrame(text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  const frame = new Uint8Array(body.length + 1);
  frame[0] = MessageTag.Json;
  frame.set(body, 1);
  return frame;
}

const jsonFrames = fc.json().map(jsonFrame);

const startWithAnyPartials = fc
  .jsonValue()
  .map((partials) => jsonFrame(JSON.stringify({ type: 'start', sessionId: 'fuzz', language: 'sk', partials })));

const startWithAnyLanguages = fc
  .tuple(fc.constantFrom('sk', 'en', 'cs', 'auto'), fc.jsonValue())
  .map(([language, languages]) => jsonFrame(JSON.stringify({ type: 'start', sessionId: 'fuzz', language, languages })));

const languageCandidates = fc.array(fc.oneof(fc.constantFrom(...DICTATION_LANGUAGES), fc.string({ maxLength: 3 })), { maxLength: 8 });

function isValidSelection(languages: readonly string[]): boolean {
  return (
    languages.length >= 1 &&
    languages.length <= MAX_DICTATION_LANGUAGES &&
    new Set(languages).size === languages.length &&
    languages.every((language) => (DICTATION_LANGUAGES as readonly string[]).includes(language))
  );
}

function decodesStart(languages: readonly string[]): boolean {
  try {
    decodeClientMessage(jsonFrame(JSON.stringify({ type: 'start', sessionId: 'fuzz', language: 'auto', languages })));
    return true;
  } catch {
    return false;
  }
}

const serverWithAnyLanguageFields = fc.oneof(
  fc.jsonValue().map((languages) => jsonFrame(JSON.stringify({ type: 'capabilities', languages, models: UNKNOWN_MODELS }))),
  fc.jsonValue().map((models) => jsonFrame(JSON.stringify({ type: 'capabilities', languages: [], models }))),
  fc.jsonValue().map((transcription) => jsonFrame(JSON.stringify({ type: 'capabilities', languages: [], models: { ...UNKNOWN_MODELS, transcription } }))),
  fc.jsonValue().map((language) => jsonFrame(JSON.stringify({ type: 'final', sessionId: 'fuzz', segmentId: 0, text: 'x', language }))),
  fc.jsonValue().map((language) => jsonFrame(JSON.stringify({ type: 'partial', sessionId: 'fuzz', segmentId: 0, revision: 0, text: 'x', language }))),
);

const selections = fc.uniqueArray(fc.constantFrom(...DICTATION_LANGUAGES), { minLength: 1, maxLength: MAX_DICTATION_LANGUAGES });
const detectedLanguages = fc.option(fc.constantFrom(...DICTATION_LANGUAGES), { nil: null });

const routedStarts = fc
  .tuple(selections, fc.option(fc.boolean(), { nil: undefined }))
  .map(([languages, partials]): ClientMessage => {
    if (partials === undefined) {
      return { type: 'start', sessionId: 'fuzz', language: 'auto', languages };
    }
    return { type: 'start', sessionId: 'fuzz', language: 'auto', partials, languages };
  });

const modelNames = fc.option(fc.string({ minLength: 1, maxLength: MAX_MODEL_NAME_CHARS }).filter(isModelName), { nil: null });
const serverModels = fc.record({ transcription: modelNames, conditioned: modelNames, languageId: modelNames });
const modelNameCandidates = fc.oneof(fc.string({ maxLength: MAX_MODEL_NAME_CHARS + 2 }), fc.string({ unit: 'grapheme', maxLength: MAX_MODEL_NAME_CHARS + 2 }));

function decodesModelName(name: string): boolean {
  try {
    decodeServerMessage(jsonFrame(JSON.stringify({ type: 'capabilities', languages: [], models: { ...UNKNOWN_MODELS, conditioned: name } })));
    return true;
  } catch {
    return false;
  }
}

function isValidModelName(name: string): boolean {
  return name.trim().length > 0 && [...name].length <= MAX_MODEL_NAME_CHARS && !/\p{Cc}/u.test(name);
}

const languageReplies = fc.oneof(
  fc
    .tuple(fc.uniqueArray(fc.constantFrom(...DICTATION_LANGUAGES)), serverModels)
    .map(([languages, models]): ServerMessage => ({ type: 'capabilities', languages, models })),
  detectedLanguages.map((language): ServerMessage => ({ type: 'final', sessionId: 'fuzz', segmentId: 0, text: 'x', language })),
  detectedLanguages.map((language): ServerMessage => ({ type: 'partial', sessionId: 'fuzz', segmentId: 0, revision: 1, text: 'x', language })),
);

const decoders = [
  ['decodeOpeningFrame', decodeOpeningFrame],
  ['decodeClientMessage', decodeClientMessage],
  ['decodeServerMessage', decodeServerMessage],
] as const;

describe('parser fuzzing', () => {
  it.each(decoders)('%s throws only ProtocolError on random bytes', (_name, decode) => {
    fc.assert(fc.property(randomBytes, onlyProtocolErrors(decode)), { numRuns: RUNS });
  });

  it.each(decoders)('%s throws only ProtocolError on random JSON', (_name, decode) => {
    fc.assert(fc.property(jsonFrames, onlyProtocolErrors(decode)), { numRuns: RUNS });
  });

  it('decodeClientMessage throws only ProtocolError for any partials value on start', () => {
    fc.assert(fc.property(startWithAnyPartials, onlyProtocolErrors(decodeClientMessage)), { numRuns: RUNS });
  });

  it('decodeClientMessage throws only ProtocolError for any languages value on start', () => {
    fc.assert(fc.property(startWithAnyLanguages, onlyProtocolErrors(decodeClientMessage)), { numRuns: RUNS });
  });

  it('accepts a languages list exactly when it is 1 to 5 unique dictation languages', () => {
    fc.assert(
      fc.property(languageCandidates, (languages) => decodesStart(languages) === isValidSelection(languages)),
      { numRuns: RUNS },
    );
  });

  it('decodeServerMessage throws only ProtocolError for any language fields', () => {
    fc.assert(fc.property(serverWithAnyLanguageFields, onlyProtocolErrors(decodeServerMessage)), { numRuns: RUNS });
  });

  it('accepts a model name exactly when it is a non-blank printable string of at most 64 characters', () => {
    fc.assert(fc.property(modelNameCandidates, (name) => decodesModelName(name) === isValidModelName(name)), { numRuns: RUNS });
  });

  it('round-trips any routed start', () => {
    fc.assert(
      fc.property(routedStarts, (message) => JSON.stringify(decodeClientMessage(encodeClientMessage(message))) === JSON.stringify(message)),
      { numRuns: 1000 },
    );
  });

  it('round-trips any capabilities reply and detected language', () => {
    fc.assert(
      fc.property(languageReplies, (message) => JSON.stringify(decodeServerMessage(encodeServerMessage(message))) === JSON.stringify(message)),
      { numRuns: 1000 },
    );
  });

  it('round-trips start with any boolean partials flag', () => {
    fc.assert(
      fc.property(fc.boolean(), (partials) => {
        const message = { type: 'start', sessionId: 'fuzz', language: 'sk', partials } as const;
        return JSON.stringify(decodeClientMessage(encodeClientMessage(message))) === JSON.stringify(message);
      }),
      { numRuns: 100 },
    );
  });

  it('parsePairingToken throws only ProtocolError on random text', () => {
    const tokenLike = fc.tuple(fc.string(), fc.string(), fc.string()).map((parts) => `cw1:${parts.join(':')}`);
    fc.assert(fc.property(fc.oneof(fc.string(), tokenLike), onlyProtocolErrors(parsePairingToken)), { numRuns: RUNS });
  });
});
