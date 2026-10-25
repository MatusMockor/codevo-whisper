import { describe, expect, it } from 'vitest';
import { parseDeviceList, parseFrame, parseLevel, parseReply, parseStartResult } from '../src/main/audio/capture-payloads';
import { IpcValidationError } from '../src/main/ipc/validate';

describe('capture payloads', () => {
  it('accepts a PCM16 frame up to the limit', () => {
    const frame = new Uint8Array(3200);

    expect(parseFrame(frame)).toBe(frame);
    expect(parseFrame(new Uint8Array(6400))).toHaveLength(6400);
  });

  it('rejects frames that are not even-length bytes within the limit', () => {
    for (const value of [new Uint8Array(0), new Uint8Array(3), new Uint8Array(6402), new Int16Array(4), [1, 2], 'pcm', null]) {
      expect(() => parseFrame(value)).toThrow(IpcValidationError);
    }
  });

  it('accepts a level between 0 and 1 only', () => {
    expect(parseLevel(0)).toBe(0);
    expect(parseLevel(0.42)).toBe(0.42);
    for (const value of [-0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '0.5', null]) {
      expect(() => parseLevel(value)).toThrow(IpcValidationError);
    }
  });

  it('accepts a bounded list of devices with string fields', () => {
    const devices = [{ deviceId: 'a', label: 'Mic A' }];

    expect(parseDeviceList(devices)).toEqual(devices);
  });

  it('rejects malformed or oversized device lists', () => {
    const tooMany = Array.from({ length: 65 }, (_, index) => ({ deviceId: String(index), label: '' }));
    const longLabel = [{ deviceId: 'a', label: 'x'.repeat(513) }];
    for (const value of [null, {}, [{ deviceId: 1, label: '' }], [{ deviceId: 'a' }], [{ deviceId: 'a', label: 'b', extra: true }], tooMany, longLabel]) {
      expect(() => parseDeviceList(value)).toThrow(IpcValidationError);
    }
  });

  it('parses the start result label and fallback flag', () => {
    expect(parseStartResult({ label: 'Fake Audio Input 1', fallback: false })).toEqual({ label: 'Fake Audio Input 1', fallback: false });
    expect(parseStartResult({ label: 'Fake Audio Input 1', fallback: true })).toEqual({ label: 'Fake Audio Input 1', fallback: true });
    for (const value of [{ label: 5, fallback: false }, { label: 'a' }, { label: 'a', fallback: 'no' }, null]) {
      expect(() => parseStartResult(value)).toThrow(IpcValidationError);
    }
  });

  it('parses success and failure replies', () => {
    expect(parseReply({ id: 3, ok: true, value: null })).toEqual({ id: 3, ok: true, value: null });
    expect(parseReply({ id: 4, ok: false, error: 'NotAllowedError' })).toEqual({ id: 4, ok: false, error: 'NotAllowedError' });
    expect(parseReply({ id: 5, ok: false, error: 'e'.repeat(1000) })).toEqual({ id: 5, ok: false, error: 'e'.repeat(256) });
  });

  it('rejects malformed replies', () => {
    for (const value of [null, { id: 0, ok: true, value: 1 }, { id: 1.5, ok: true }, { id: 2, ok: 'yes' }, { id: 2, ok: false, error: 3 }]) {
      expect(() => parseReply(value)).toThrow(IpcValidationError);
    }
  });
});
