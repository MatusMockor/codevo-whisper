import { describe, expect, it } from 'vitest';
import { readPcmFromWav } from '../src/wav-reader';

function wav(options: { sampleRate?: number; channels?: number; bits?: number; data: Uint8Array; extraChunk?: boolean }): Uint8Array {
  const extra = options.extraChunk === true ? 12 : 0;
  const bytes = new Uint8Array(44 + extra + options.data.length);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, options.channels ?? 1, true);
  view.setUint32(24, options.sampleRate ?? 16000, true);
  view.setUint32(28, (options.sampleRate ?? 16000) * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, options.bits ?? 16, true);
  if (extra > 0) {
    ascii(36, 'LIST');
    view.setUint32(40, 4, true);
    ascii(44, 'abcd');
  }
  ascii(36 + extra, 'data');
  view.setUint32(40 + extra, options.data.length, true);
  bytes.set(options.data, 44 + extra);
  return bytes;
}

describe('readPcmFromWav', () => {
  it('returns the PCM16 mono 16 kHz samples', () => {
    expect(readPcmFromWav(wav({ data: Uint8Array.of(1, 2, 3, 4) }))).toEqual(Uint8Array.of(1, 2, 3, 4));
  });

  it('skips unknown chunks', () => {
    expect(readPcmFromWav(wav({ data: Uint8Array.of(5, 6), extraChunk: true }))).toEqual(Uint8Array.of(5, 6));
  });

  it('rejects other formats', () => {
    expect(() => readPcmFromWav(wav({ sampleRate: 44100, data: Uint8Array.of(1, 2) }))).toThrow(/16 kHz/);
    expect(() => readPcmFromWav(wav({ channels: 2, data: Uint8Array.of(1, 2) }))).toThrow(/mono/);
    expect(() => readPcmFromWav(new TextEncoder().encode('not a wav file at all, definitely not'))).toThrow(/WAV/);
  });
});
