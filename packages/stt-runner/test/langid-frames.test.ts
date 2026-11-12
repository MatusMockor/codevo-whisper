import { describe, expect, it } from 'vitest';
import { LANGUAGE_CODES, type LanguageCode } from '../src/languages';
import { TranscribeCliError } from '../src/transcribe-cli-error';
import { encodeLanguageIdRequest, parseLanguageIdReply } from '../src/worker/langid-frames';

const SK_CS_EN: readonly LanguageCode[] = ['sk', 'cs', 'en'];

describe('language id frames', () => {
  it('encodes the frame type, the allowed codes, the sample count and the PCM', () => {
    expect([...encodeLanguageIdRequest(['sk', 'cs'], new Uint8Array([1, 2, 3, 4, 5]))]).toEqual([
      0xfe, 2, 2, 0x73, 0x6b, 2, 0x63, 0x73, 2, 0, 0, 0, 1, 2, 3, 4,
    ]);
  });

  it('encodes all 25 supported codes in one frame', () => {
    const frame = encodeLanguageIdRequest(LANGUAGE_CODES, new Uint8Array(0));

    expect(frame[1]).toBe(25);
    expect(frame.length).toBe(2 + 25 * 3 + 4);
  });

  it('refuses an empty, unknown or repeated allowed set', () => {
    for (const allowed of [[], ['xx'], ['sk', 'toString'], ['sk', 'sk'], ['SK']]) {
      expect(() => encodeLanguageIdRequest(allowed as LanguageCode[], new Uint8Array(2))).toThrow(RangeError);
    }
  });

  it('refuses more than 30 s of audio', () => {
    expect(() => encodeLanguageIdRequest(['sk'], new Uint8Array(480_001 * 2))).toThrow(RangeError);
    expect(encodeLanguageIdRequest(['sk'], new Uint8Array(480_000 * 2)).length).toBe(2 + 3 + 4 + 960_000);
  });

  it('parses ranked "code p" lines', () => {
    expect(parseLanguageIdReply('cs 0.912000\nsk 0.080000\nen 0.008000\n', SK_CS_EN)).toEqual([
      { code: 'cs', p: 0.912 },
      { code: 'sk', p: 0.08 },
      { code: 'en', p: 0.008 },
    ]);
  });

  it('parses the native %.9g reply with exponents and a newline after every line', () => {
    expect(parseLanguageIdReply('sk 0.999994695\ncs 5.30480773e-06\nen 7.45887117e-14\n', SK_CS_EN)).toEqual([
      { code: 'sk', p: 0.999994695 },
      { code: 'cs', p: 5.30480773e-6 },
      { code: 'en', p: 7.45887117e-14 },
    ]);
  });

  it('accepts equal probabilities and exponent notation', () => {
    expect(parseLanguageIdReply('sk 0.5\ncs 0.5\nen 1e-7', SK_CS_EN)).toEqual([
      { code: 'sk', p: 0.5 },
      { code: 'cs', p: 0.5 },
      { code: 'en', p: 1e-7 },
    ]);
  });

  it.each([
    ['an empty reply', ''],
    ['a missing line', 'sk 0.9\ncs 0.1'],
    ['an extra line', 'sk 0.9\ncs 0.05\nen 0.03\nde 0.02'],
    ['a code outside the request', 'sk 0.9\ncs 0.05\nde 0.05'],
    ['a repeated code', 'sk 0.9\nsk 0.05\nen 0.05'],
    ['an unranked list', 'sk 0.1\ncs 0.8\nen 0.1'],
    ['a probability above 1', 'sk 1.5\ncs 0\nen 0'],
    ['a negative probability', 'sk 0.9\ncs 0.1\nen -0.1'],
    ['a non-numeric probability', 'sk NaN\ncs 0\nen 0'],
    ['a malformed line', 'sk=0.9\ncs 0.05\nen 0.05'],
    ['probabilities with no mass', 'sk 0\ncs 0\nen 0'],
    ['probabilities with excess mass', 'sk 1\ncs 1\nen 1'],
    ['trailing fields', 'sk 0.9 extra\ncs 0.05\nen 0.05'],
  ])('rejects %s', (_name, text) => {
    expect(() => parseLanguageIdReply(text, SK_CS_EN)).toThrow(TranscribeCliError);
  });
});
