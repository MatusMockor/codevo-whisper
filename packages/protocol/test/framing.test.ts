import { describe, expect, it } from 'vitest';
import { ProtocolError } from '../src/errors';
import { decodeOpeningFrame, encodeOpeningFrame, HandshakeMode, PROLOGUE_PAIR, PROLOGUE_SESSION } from '../src/framing';

describe('opening frame', () => {
  it('round-trips the mode and the noise message', () => {
    const noiseMessage = new Uint8Array([1, 2, 3, 4]);

    [HandshakeMode.Pair, HandshakeMode.Session].forEach((mode) => {
      const decoded = decodeOpeningFrame(encodeOpeningFrame(mode, noiseMessage));
      expect(decoded.mode).toBe(mode);
      expect(decoded.noiseMessage).toEqual(noiseMessage);
    });
  });

  it('uses the protocol prologues', () => {
    expect(new TextDecoder().decode(PROLOGUE_PAIR)).toBe('cw1/pair');
    expect(new TextDecoder().decode(PROLOGUE_SESSION)).toBe('cw1/session');
  });

  it('rejects an unknown mode byte', () => {
    expect(() => decodeOpeningFrame(new Uint8Array([0x03, 1, 2]))).toThrow(ProtocolError);
    expect(() => decodeOpeningFrame(new Uint8Array([0x00, 1, 2]))).toThrow(ProtocolError);
  });

  it('rejects an empty frame and a frame without a noise message', () => {
    expect(() => decodeOpeningFrame(new Uint8Array(0))).toThrow(ProtocolError);
    expect(() => decodeOpeningFrame(new Uint8Array([HandshakeMode.Session]))).toThrow(ProtocolError);
  });

  it('rejects a noise message larger than 65535 bytes', () => {
    const frame = new Uint8Array(65537);
    frame[0] = HandshakeMode.Session;

    expect(() => decodeOpeningFrame(frame)).toThrow(ProtocolError);
  });

  it('reports bad_message', () => {
    expect(() => decodeOpeningFrame(new Uint8Array(0))).toThrow(expect.objectContaining({ code: 'bad_message' }));
  });
});
