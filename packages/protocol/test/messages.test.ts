import { describe, expect, it } from 'vitest';
import { ProtocolError } from '../src/errors';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  MessageTag,
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
    { type: 'start', sessionId: '3f1c2a9e-0b4e-4d8a-a651-f03c9d6e27a4', language: 'sk' },
    { type: 'start', sessionId: 'live', language: 'cs', partials: true },
    { type: 'start', sessionId: 'quiet', language: 'en', partials: false },
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
    { type: 'partial', sessionId: 's1', segmentId: 0, revision: 2, text: 'ahoj sv' },
    { type: 'final', sessionId: 's1', segmentId: 0, text: 'ahoj svet' },
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
