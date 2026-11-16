import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ProtocolError } from '../src/errors';
import { assertOnlyKeys } from '../src/json-fields';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  MAX_TRANSCRIPTION_MODELS,
  MessageTag,
  UNKNOWN_MODELS,
  type CatalogEntry,
  type ClientMessage,
  type ServerMessage,
} from '../src/messages';
import { MODEL_CATALOG_MIN_VERSION } from '../src/version';

const encoder = new TextEncoder();

function json(value: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(value));
  const frame = new Uint8Array(body.length + 1);
  frame[0] = MessageTag.Json;
  frame.set(body, 1);
  return frame;
}

function body(frame: Uint8Array): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(frame.subarray(1))) as Record<string, unknown>;
}

function expectBadMessage(work: () => unknown): void {
  expect(work).toThrow(ProtocolError);
  expect(work).toThrow(expect.objectContaining({ code: 'bad_message' }));
}

const PARAKEET: CatalogEntry = { id: 'parakeet-ultra', name: 'Parakeet Ultra (F16)', family: 'parakeet', sizeBytes: 1_256_724_448, removable: false, state: 'installed', receivedBytes: null };
const TURBO: CatalogEntry = {
  id: 'whisper-large-v3-turbo',
  name: 'Whisper Large v3 Turbo (F16)',
  family: 'whisper',
  sizeBytes: 1_625_935_488,
  removable: true,
  state: 'downloading',
  receivedBytes: 1_000,
};

function capabilities(modelCatalog: unknown): Uint8Array {
  return json({ type: 'capabilities', languages: [], models: UNKNOWN_MODELS, modelCatalog });
}

function catalog(models: unknown, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { canManage: true, downloadsEnabled: true, models, ...fields };
}

function entry(fields: Record<string, unknown>): Record<string, unknown> {
  return { ...TURBO, ...fields };
}

describe('model catalog', () => {
  it('gates the catalog and the model commands at server 0.6.0', () => {
    expect(MODEL_CATALOG_MIN_VERSION).toBe('0.6.0');
  });

  it.each<ClientMessage>([
    { type: 'capabilities', modelCatalog: true },
    { type: 'capabilities', transcriptionModels: true, modelCatalog: true },
    { type: 'capabilities', modelCatalog: false },
    { type: 'model-download', id: 'whisper-large-v3-turbo' },
    { type: 'model-remove', id: 'parakeet-ultra-q8' },
    { type: 'model-download-cancel', id: 'whisper-large-v3' },
  ])('round-trips the client message %o', (message) => {
    expect(decodeClientMessage(encodeClientMessage(message))).toEqual(message);
  });

  it.each<ServerMessage>([
    { type: 'capabilities', languages: [], models: UNKNOWN_MODELS, modelCatalog: { canManage: false, downloadsEnabled: true, models: [] } },
    { type: 'capabilities', languages: ['sk'], models: UNKNOWN_MODELS, transcriptionModels: [], modelCatalog: { canManage: true, downloadsEnabled: false, models: [PARAKEET, TURBO] } },
    { type: 'capabilities', languages: [], models: UNKNOWN_MODELS, modelCatalog: { canManage: true, downloadsEnabled: true, models: [{ ...TURBO, state: 'failed', receivedBytes: null }] } },
    { type: 'model-operation', id: 'whisper-large-v3-turbo', operation: 'download', outcome: 'started' },
    { type: 'model-operation', id: 'parakeet-ultra', operation: 'remove', outcome: 'model_not_removable' },
    { type: 'model-operation', id: 'whisper-large-v3', operation: 'cancel', outcome: 'idle' },
  ])('round-trips the server message %o', (message) => {
    expect(decodeServerMessage(encodeServerMessage(message))).toEqual(message);
  });

  it('decodes a capabilities request and reply without the catalog exactly as before', () => {
    expect(decodeClientMessage(json({ type: 'capabilities', transcriptionModels: true }))).toStrictEqual({ type: 'capabilities', transcriptionModels: true });
    expect(decodeServerMessage(json({ type: 'capabilities', languages: [], models: UNKNOWN_MODELS, transcriptionModels: [] }))).toStrictEqual({
      type: 'capabilities',
      languages: [],
      models: UNKNOWN_MODELS,
      transcriptionModels: [],
    });
  });

  it('rejects malformed model commands', () => {
    ['', 'Whisper', 'whisper large', 1, null, ['whisper-large-v3']].forEach((id) => {
      expectBadMessage(() => decodeClientMessage(json({ type: 'model-download', id })));
    });
    expectBadMessage(() => decodeClientMessage(json({ type: 'model-remove' })));
    expectBadMessage(() => decodeClientMessage(json({ type: 'model-download-cancel', id: 'whisper-large-v3', force: true })));
    ['yes', 1, null].forEach((modelCatalog) => {
      expectBadMessage(() => decodeClientMessage(json({ type: 'capabilities', modelCatalog })));
    });
  });

  it('rejects malformed operation replies', () => {
    const valid = { type: 'model-operation', id: 'whisper-large-v3', operation: 'download', outcome: 'started' };

    expect(decodeServerMessage(json(valid))).toEqual(valid);
    [{ operation: 'install' }, { outcome: 'done' }, { id: 'Whisper' }, { extra: 1 }].forEach((fields) => {
      expectBadMessage(() => decodeServerMessage(json({ ...valid, ...fields })));
    });
  });

  it('accepts up to the maximum number of catalog models and rejects longer lists', () => {
    const many = Array.from({ length: MAX_TRANSCRIPTION_MODELS + 1 }, (_, index) => entry({ id: `model-${index}` }));

    expect(decodeServerMessage(capabilities(catalog(many.slice(0, MAX_TRANSCRIPTION_MODELS))))).toMatchObject({ modelCatalog: { models: many.slice(0, MAX_TRANSCRIPTION_MODELS) } });
    expectBadMessage(() => decodeServerMessage(capabilities(catalog(many))));
  });

  it('carries received bytes only while a model downloads', () => {
    expect(decodeServerMessage(capabilities(catalog([entry({ receivedBytes: 0 })])))).toMatchObject({ modelCatalog: { models: [{ receivedBytes: 0 }] } });
    expectBadMessage(() => decodeServerMessage(capabilities(catalog([entry({ receivedBytes: null })]))));
    expectBadMessage(() => decodeServerMessage(capabilities(catalog([entry({ state: 'installed' })]))));
    expectBadMessage(() => decodeServerMessage(capabilities(catalog([entry({ state: 'missing', receivedBytes: 5 })]))));
  });

  it('rejects malformed catalogs and entries', () => {
    const malformedCatalogs: unknown[] = [
      null,
      [],
      catalog('models'),
      catalog([TURBO, TURBO]),
      catalog([], { canManage: 'yes' }),
      catalog([], { downloadsEnabled: undefined }),
      catalog([], { extra: true }),
      catalog([entry({ family: 'canary' })]),
      catalog([entry({ state: 'paused' })]),
      catalog([entry({ sizeBytes: -1 })]),
      catalog([entry({ sizeBytes: 1.5 })]),
      catalog([entry({ receivedBytes: -1 })]),
      catalog([entry({ removable: 'no' })]),
      catalog([entry({ name: '' })]),
      catalog([entry({ id: 'Turbo' })]),
      catalog([entry({ url: 'https://example.com' })]),
      catalog([{ id: 'whisper-large-v3', name: 'Whisper', family: 'whisper', sizeBytes: 1, removable: true, state: 'missing' }]),
    ];

    malformedCatalogs.forEach((modelCatalog) => {
      expectBadMessage(() => decodeServerMessage(capabilities(modelCatalog)));
    });
  });

  it('adds no error codes, so every refusal travels in the operation reply and the close codes stay stable', () => {
    expect(ERROR_CODES.at(-1)).toBe('model_unavailable');
  });

  it('would be rejected by a decoder that predates the catalog, so the new fields need the server version gate', () => {
    const LEGACY_CAPABILITIES_REQUEST_KEYS = ['type', 'transcriptionModels'];
    const LEGACY_CAPABILITIES_REPLY_KEYS = ['type', 'languages', 'models', 'transcriptionModels'];
    const reply = encodeServerMessage({ type: 'capabilities', languages: [], models: UNKNOWN_MODELS, modelCatalog: { canManage: false, downloadsEnabled: true, models: [] } });

    expectBadMessage(() => assertOnlyKeys(body(encodeClientMessage({ type: 'capabilities', modelCatalog: true })), LEGACY_CAPABILITIES_REQUEST_KEYS));
    expectBadMessage(() => assertOnlyKeys(body(reply), LEGACY_CAPABILITIES_REPLY_KEYS));
    expect(() => assertOnlyKeys(body(encodeServerMessage({ type: 'capabilities', languages: [], models: UNKNOWN_MODELS, transcriptionModels: [] })), LEGACY_CAPABILITIES_REPLY_KEYS)).not.toThrow();
  });
});
