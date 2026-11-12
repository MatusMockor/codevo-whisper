import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ProtocolError } from '../src/errors';
import { assertOnlyKeys, readChoice } from '../src/json-fields';
import {
  DICTATION_LANGUAGES,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  MAX_DICTATION_LANGUAGES,
  MAX_MODEL_NAME_CHARS,
  MessageTag,
  UNKNOWN_MODELS,
  type ClientMessage,
  type ServerMessage,
} from '../src/messages';

const encoder = new TextEncoder();

function json(value: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(value));
  const frame = new Uint8Array(body.length + 1);
  frame[0] = MessageTag.Json;
  frame.set(body, 1);
  return frame;
}

function expectBadMessage(work: () => unknown): void {
  expect(work).toThrow(ProtocolError);
  expect(work).toThrow(expect.objectContaining({ code: 'bad_message' }));
}

describe('client messages', () => {
  const messages: ClientMessage[] = [
    { type: 'hello' },
    { type: 'capabilities' },
    { type: 'start', sessionId: '3f1c2a9e-0b4e-4d8a-a651-f03c9d6e27a4', language: 'sk' },
    { type: 'start', sessionId: 'live', language: 'cs', partials: true },
    { type: 'start', sessionId: 'quiet', language: 'en', partials: false },
    { type: 'start', sessionId: 'routed', language: 'auto', languages: ['sk', 'cs', 'en'] },
    { type: 'start', sessionId: 'routed-live', language: 'auto', partials: true, languages: ['uk'] },
    { type: 'audio', pcm: new Uint8Array([1, 2, 3, 4]) },
    { type: 'finish' },
    { type: 'cancel' },
    { type: 'pair-request', deviceName: 'MacBook dev' },
  ];

  it.each(messages.map((message) => [message.type, message] as const))('round-trips %s', (_type, message) => {
    expect(decodeClientMessage(encodeClientMessage(message))).toEqual(message);
  });

  it('accepts every language', () => {
    (['sk', 'en', 'cs', 'auto'] as const).forEach((language) => {
      const message: ClientMessage = { type: 'start', sessionId: 'abc', language };
      expect(decodeClientMessage(encodeClientMessage(message))).toEqual(message);
    });
  });

  it('carries audio as raw PCM after the tag', () => {
    const frame = encodeClientMessage({ type: 'audio', pcm: new Uint8Array([9, 8]) });

    expect([...frame]).toEqual([MessageTag.Audio, 9, 8]);
  });

  it('rejects audio with an odd or empty byte length', () => {
    expectBadMessage(() => decodeClientMessage(new Uint8Array([MessageTag.Audio, 1, 2, 3])));
    expectBadMessage(() => decodeClientMessage(new Uint8Array([MessageTag.Audio])));
  });

  it('rejects JSON with an unknown type', () => {
    expectBadMessage(() => decodeClientMessage(json({ type: 'explode' })));
    expectBadMessage(() => decodeClientMessage(json({ type: 'ready', serverVersion: '1' })));
    expectBadMessage(() => decodeClientMessage(json({ type: 'audio', pcm: 'AAAA' })));
  });

  it('rejects a deviceName longer than 64 characters', () => {
    expect(decodeClientMessage(json({ type: 'pair-request', deviceName: 'á'.repeat(64) }))).toEqual({
      type: 'pair-request',
      deviceName: 'á'.repeat(64),
    });
    expectBadMessage(() => decodeClientMessage(json({ type: 'pair-request', deviceName: 'a'.repeat(65) })));
  });

  it('rejects an empty deviceName and control characters', () => {
    expectBadMessage(() => decodeClientMessage(json({ type: 'pair-request', deviceName: '   ' })));
    expectBadMessage(() => decodeClientMessage(json({ type: 'pair-request', deviceName: 'Mac\u001b[2J' })));
    expectBadMessage(() => decodeClientMessage(json({ type: 'pair-request', deviceName: 'Mac\nBook' })));
  });

  it('decodes a start without partials as a message without the field', () => {
    const decoded = decodeClientMessage(json({ type: 'start', sessionId: 'abc', language: 'sk' }));

    expect(decoded).toEqual({ type: 'start', sessionId: 'abc', language: 'sk' });
    expect(Object.keys(decoded)).not.toContain('partials');
  });

  it('omits partials from the encoded start when it is not set', () => {
    const frame = encodeClientMessage({ type: 'start', sessionId: 'abc', language: 'sk' });

    expect(new TextDecoder().decode(frame.subarray(1))).toBe('{"type":"start","sessionId":"abc","language":"sk"}');
  });

  it('rejects a partials flag that is not a boolean', () => {
    ['yes', 1, null, {}, []].forEach((partials) => {
      expectBadMessage(() => decodeClientMessage(json({ type: 'start', sessionId: 'abc', language: 'sk', partials })));
    });
  });

  it('rejects a language outside the four values', () => {
    expectBadMessage(() => decodeClientMessage(json({ type: 'start', sessionId: 'abc', language: 'de' })));
    expectBadMessage(() => decodeClientMessage(json({ type: 'start', sessionId: 'abc' })));
  });

  it('rejects an invalid sessionId', () => {
    expectBadMessage(() => decodeClientMessage(json({ type: 'start', sessionId: '', language: 'sk' })));
    expectBadMessage(() => decodeClientMessage(json({ type: 'start', sessionId: 'a'.repeat(65), language: 'sk' })));
    expectBadMessage(() => decodeClientMessage(json({ type: 'start', sessionId: 'a b', language: 'sk' })));
    expectBadMessage(() => decodeClientMessage(json({ type: 'start', sessionId: 7, language: 'sk' })));
  });

  it('rejects unknown fields, non-objects, invalid JSON and invalid UTF-8', () => {
    expectBadMessage(() => decodeClientMessage(json({ type: 'finish', extra: true })));
    expectBadMessage(() => decodeClientMessage(json(['finish'])));
    expectBadMessage(() => decodeClientMessage(json(null)));
    expectBadMessage(() => decodeClientMessage(new Uint8Array([MessageTag.Json, 0x7b])));
    expectBadMessage(() => decodeClientMessage(new Uint8Array([MessageTag.Json, 0xff, 0xfe])));
  });

  it('rejects an empty frame and an unknown tag', () => {
    expectBadMessage(() => decodeClientMessage(new Uint8Array(0)));
    expectBadMessage(() => decodeClientMessage(new Uint8Array([0x7f, 0x7b, 0x7d])));
  });
});

describe('server messages', () => {
  const messages: ServerMessage[] = [
    { type: 'ready', serverVersion: '0.0.0' },
    { type: 'capabilities', languages: [], models: UNKNOWN_MODELS },
    {
      type: 'capabilities',
      languages: [...DICTATION_LANGUAGES],
      models: { transcription: 'Parakeet Ultra (F16)', conditioned: 'Canary 1B v2 (Q8)', languageId: 'VoxLingua107 (rozpoznanie jazyka)' },
    },
    { type: 'capabilities', languages: [], models: { transcription: 'parakeet-ultra-F16', conditioned: null, languageId: null } },
    { type: 'partial', sessionId: 's1', segmentId: 0, revision: 2, text: 'ahoj sv' },
    { type: 'partial', sessionId: 's1', segmentId: 0, revision: 3, text: 'ahoj sve', language: 'sk' },
    { type: 'partial', sessionId: 's1', segmentId: 0, revision: 4, text: 'ahoj svet', language: null },
    { type: 'final', sessionId: 's1', segmentId: 0, text: 'ahoj svet' },
    { type: 'final', sessionId: 's1', segmentId: 0, text: 'ahoj svete', language: 'cs' },
    { type: 'final', sessionId: 's1', segmentId: 0, text: 'ahoj', language: null },
    { type: 'error', code: 'languages_unavailable', message: 'models missing', sessionId: 's1' },
    { type: 'final', sessionId: 's1', segmentId: 1, text: '' },
    { type: 'done', sessionId: 's1' },
    { type: 'flow', paused: true },
    { type: 'error', code: 'stt_unavailable', message: 'STT is down' },
    { type: 'error', code: 'stt_unavailable', message: 'STT is down', sessionId: 's1' },
    { type: 'pair-result', status: 'approved', deviceId: '7f3a92c1' },
    { type: 'pair-result', status: 'rejected' },
  ];

  it.each(messages.map((message) => [message.type, message] as const))('round-trips %s', (_type, message) => {
    expect(decodeServerMessage(encodeServerMessage(message))).toEqual(message);
  });

  it('rejects malformed server messages', () => {
    expectBadMessage(() => decodeServerMessage(json({ type: 'final', sessionId: 's1', segmentId: -1, text: 'x' })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'final', sessionId: 's1', segmentId: 1.5, text: 'x' })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'final', segmentId: 0, text: 'x' })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'final', sessionId: 'a b', segmentId: 0, text: 'x' })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'done' })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'error', code: 'busy', message: 'x', sessionId: '' })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'flow', paused: 'yes' })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'partial', sessionId: 's1', segmentId: 0, text: 'x' })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'partial', sessionId: 's1', segmentId: 0, revision: -1, text: 'x' })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'partial', sessionId: 's1', segmentId: 0, revision: 1, text: 'x', final: true })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'partial', segmentId: 0, revision: 1, text: 'x' })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'error', code: 'nope', message: 'x' })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'pair-result', status: 'approved' })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'pair-result', status: 'rejected', deviceId: 'abc' })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'start', sessionId: 'abc', language: 'sk' })));
    expectBadMessage(() => decodeServerMessage(new Uint8Array([MessageTag.Audio, 1, 2])));
  });
});

describe('dictation languages', () => {
  function start(fields: Record<string, unknown>): Uint8Array {
    return json({ type: 'start', sessionId: 'abc', language: 'auto', ...fields });
  }

  it('offers the 25 languages shared by Parakeet, Canary and the language ID and caps a selection at 5', () => {
    expect(DICTATION_LANGUAGES).toEqual([
      'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hr', 'hu', 'it',
      'lt', 'lv', 'mt', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'uk',
    ]);
    expect(MAX_DICTATION_LANGUAGES).toBe(5);
  });

  it('accepts every dictation language and a selection of 5', () => {
    DICTATION_LANGUAGES.forEach((language) => {
      expect(decodeClientMessage(start({ languages: [language] }))).toMatchObject({ languages: [language] });
    });
    expect(decodeClientMessage(start({ languages: ['sk', 'cs', 'en', 'de', 'pl'] }))).toMatchObject({
      languages: ['sk', 'cs', 'en', 'de', 'pl'],
    });
  });

  it('keeps the order of the selection', () => {
    expect(decodeClientMessage(start({ languages: ['en', 'sk', 'cs'] }))).toMatchObject({ languages: ['en', 'sk', 'cs'] });
  });

  it('rejects languages together with a language other than auto', () => {
    (['sk', 'en', 'cs'] as const).forEach((language) => {
      expectBadMessage(() => decodeClientMessage(start({ language, languages: ['sk'] })));
    });
  });

  it('rejects an empty selection, more than 5 languages and duplicates', () => {
    expectBadMessage(() => decodeClientMessage(start({ languages: [] })));
    expectBadMessage(() => decodeClientMessage(start({ languages: ['sk', 'cs', 'en', 'de', 'pl', 'uk'] })));
    expectBadMessage(() => decodeClientMessage(start({ languages: ['sk', 'cs', 'sk'] })));
  });

  it('rejects unknown codes and values that are not a list of codes', () => {
    expectBadMessage(() => decodeClientMessage(start({ languages: ['sk', 'ja'] })));
    expectBadMessage(() => decodeClientMessage(start({ languages: ['auto'] })));
    expectBadMessage(() => decodeClientMessage(start({ languages: ['SK'] })));
    expectBadMessage(() => decodeClientMessage(start({ languages: 'sk' })));
    expectBadMessage(() => decodeClientMessage(start({ languages: null })));
    expectBadMessage(() => decodeClientMessage(start({ languages: [1] })));
    expectBadMessage(() => decodeClientMessage(start({ languages: [['sk']] })));
    expectBadMessage(() => decodeClientMessage(start({ languages: { 0: 'sk' } })));
  });

  it('rejects fields on the capabilities request', () => {
    expectBadMessage(() => decodeClientMessage(json({ type: 'capabilities', languages: ['sk'] })));
  });

  it('rejects malformed capabilities replies', () => {
    const models = UNKNOWN_MODELS;
    expectBadMessage(() => decodeServerMessage(json({ type: 'capabilities', models })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'capabilities', languages: null, models })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'capabilities', languages: ['sk', 'sk'], models })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'capabilities', languages: ['xx'], models })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'capabilities', languages: [...DICTATION_LANGUAGES, 'sk'], models })));
    expectBadMessage(() => decodeServerMessage(json({ type: 'capabilities', languages: [], models, routes: 1 })));
  });

  it('requires the models a server runs in the capabilities reply', () => {
    expectBadMessage(() => decodeServerMessage(json({ type: 'capabilities', languages: [] })));
    [null, 'Parakeet', [], ['Parakeet'], 1].forEach((models) => {
      expectBadMessage(() => decodeServerMessage(json({ type: 'capabilities', languages: [], models })));
    });
  });

  it('rejects models with missing or unknown roles', () => {
    const capabilities = (models: unknown): Uint8Array => json({ type: 'capabilities', languages: [], models });
    expectBadMessage(() => decodeServerMessage(capabilities({ transcription: null, conditioned: null })));
    expectBadMessage(() => decodeServerMessage(capabilities({ ...UNKNOWN_MODELS, diarizer: null })));
    expectBadMessage(() => decodeServerMessage(capabilities({})));
  });

  it('accepts a model name up to the limit and rejects empty, longer, control and non-string names', () => {
    const capabilities = (transcription: unknown): Uint8Array => json({ type: 'capabilities', languages: [], models: { ...UNKNOWN_MODELS, transcription } });
    const longest = 'm'.repeat(MAX_MODEL_NAME_CHARS);

    expect(decodeServerMessage(capabilities(longest))).toEqual({ type: 'capabilities', languages: [], models: { ...UNKNOWN_MODELS, transcription: longest } });
    ['', '   ', 'm'.repeat(MAX_MODEL_NAME_CHARS + 1), 'Parakeet\n', 'Canary\u0000', 1, false, {}, ['Parakeet']].forEach((name) => {
      expectBadMessage(() => decodeServerMessage(capabilities(name)));
    });
  });

  it('rejects a detected language outside the dictation languages', () => {
    ['auto', 'ja', '', 1, false, [], {}].forEach((language) => {
      expectBadMessage(() => decodeServerMessage(json({ type: 'final', sessionId: 's1', segmentId: 0, text: 'x', language })));
      expectBadMessage(() => decodeServerMessage(json({ type: 'partial', sessionId: 's1', segmentId: 0, revision: 0, text: 'x', language })));
    });
  });

  it('adds languages_unavailable after the existing error codes so their close codes stay stable', () => {
    expect(ERROR_CODES.indexOf('server_key_changed')).toBe(9);
    expect(ERROR_CODES.at(-1)).toBe('languages_unavailable');
  });
});

describe('compatibility with peers that predate dictation languages', () => {
  const LEGACY_START_KEYS = ['type', 'sessionId', 'language', 'partials'];
  const LEGACY_FINAL_KEYS = ['type', 'sessionId', 'segmentId', 'text'];
  const LEGACY_CLIENT_TYPES = ['hello', 'start', 'finish', 'cancel', 'pair-request'] as const;
  const LEGACY_SERVER_TYPES = ['ready', 'partial', 'final', 'done', 'flow', 'error', 'pair-result'] as const;

  function body(frame: Uint8Array): Record<string, unknown> {
    return JSON.parse(new TextDecoder().decode(frame.subarray(1))) as Record<string, unknown>;
  }

  it('encodes a start without languages byte for byte as before', () => {
    expect(new TextDecoder().decode(encodeClientMessage({ type: 'start', sessionId: 'abc', language: 'sk', partials: true }).subarray(1))).toBe(
      '{"type":"start","sessionId":"abc","language":"sk","partials":true}',
    );
    expect(new TextDecoder().decode(encodeServerMessage({ type: 'final', sessionId: 's1', segmentId: 0, text: 'x' }).subarray(1))).toBe(
      '{"type":"final","sessionId":"s1","segmentId":0,"text":"x"}',
    );
  });

  it('would be rejected by a legacy strict decoder, so new fields need the server version gate', () => {
    const start = body(encodeClientMessage({ type: 'start', sessionId: 'abc', language: 'auto', languages: ['sk'] }));
    const final = body(encodeServerMessage({ type: 'final', sessionId: 's1', segmentId: 0, text: 'x', language: 'sk' }));

    expect(() => assertOnlyKeys(body(encodeClientMessage({ type: 'start', sessionId: 'abc', language: 'sk', partials: true })), LEGACY_START_KEYS)).not.toThrow();
    expect(() => assertOnlyKeys(body(encodeServerMessage({ type: 'final', sessionId: 's1', segmentId: 0, text: 'x' })), LEGACY_FINAL_KEYS)).not.toThrow();
    expectBadMessage(() => assertOnlyKeys(start, LEGACY_START_KEYS));
    expectBadMessage(() => assertOnlyKeys(final, LEGACY_FINAL_KEYS));
    expectBadMessage(() => readChoice(body(encodeClientMessage({ type: 'capabilities' })), 'type', LEGACY_CLIENT_TYPES));
    expectBadMessage(() => readChoice(body(encodeServerMessage({ type: 'capabilities', languages: [], models: UNKNOWN_MODELS })), 'type', LEGACY_SERVER_TYPES));
  });
});
