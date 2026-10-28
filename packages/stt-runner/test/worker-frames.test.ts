import { describe, expect, it } from 'vitest';
import { TranscribeCliError } from '../src/transcribe-cli-error';
import type { TranscribeLanguage } from '../src/run-transcribe-cli';
import { encodeWorkerRequest, WorkerReplyReader } from '../src/worker/worker-frames';

function reply(status: number, body: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header[0] = status;
  header.writeUInt32LE(body.length, 1);
  return Buffer.concat([header, body]);
}

describe('worker frames', () => {
  it('encodes non-ASCII per-request vocabulary and preserves empty legacy bytes', () => {
    expect([...encodeWorkerRequest('sk', new Uint8Array([1, 2]), ['Žilina', 'AI'])]).toEqual([
      255, 2, 115, 107, 1, 0, 0, 0, 2, 7, 0, 197, 189, 105, 108, 105, 110, 97, 2, 0, 65, 73, 1, 2,
    ]);
    expect([...encodeWorkerRequest('auto', new Uint8Array([9, 9]), [])]).toEqual([0, 1, 0, 0, 0, 9, 9]);
  });

  it('bounds vocabulary before sending a frame', () => {
    for (const vocabulary of [Array.from({ length: 101 }, () => 'word'), ['a'.repeat(65)], ['a\u0000b'], ['a\nb'], [''], ['\ud800']]) {
      expect(() => encodeWorkerRequest('en', new Uint8Array(2), vocabulary)).toThrow(RangeError);
    }
  });
  it('encodes the language, the sample count and the PCM', () => {
    expect([...encodeWorkerRequest('sk', new Uint8Array([1, 2, 3, 4]))]).toEqual([2, 0x73, 0x6b, 2, 0, 0, 0, 1, 2, 3, 4]);
    expect([...encodeWorkerRequest('auto', new Uint8Array([9, 9]))]).toEqual([0, 1, 0, 0, 0, 9, 9]);
  });

  it('refuses a language outside the whitelist', () => {
    expect(() => encodeWorkerRequest('de' as TranscribeLanguage, new Uint8Array(2))).toThrow(RangeError);
    expect(() => encodeWorkerRequest('s\u0000' as TranscribeLanguage, new Uint8Array(2))).toThrow(RangeError);
  });

  it('refuses more than 30 s of audio', () => {
    expect(() => encodeWorkerRequest('sk', new Uint8Array(480_000 * 2 + 2))).toThrow(RangeError);
    expect(encodeWorkerRequest('sk', new Uint8Array(480_000 * 2)).length).toBe(7 + 960_000);
  });

  it('reassembles replies split across chunks', () => {
    const reader = new WorkerReplyReader(100);
    const bytes = Buffer.concat([reply(2, Buffer.alloc(0)), reply(0, Buffer.from('ahoj svet', 'utf8'))]);

    expect(reader.push(bytes.subarray(0, 3))).toEqual([]);
    expect(reader.push(bytes.subarray(3, 9))).toEqual([{ status: 'ready', text: '' }]);
    expect(reader.push(bytes.subarray(9))).toEqual([{ status: 'ok', text: 'ahoj svet' }]);
  });

  it('rejects invalid UTF-8, unknown statuses and oversized replies', () => {
    expect(() => new WorkerReplyReader(100).push(reply(0, Buffer.from([0xff, 0xfe])))).toThrow(TranscribeCliError);
    expect(() => new WorkerReplyReader(100).push(reply(7, Buffer.alloc(0)))).toThrow(TranscribeCliError);
    expect(() => new WorkerReplyReader(4).push(reply(0, Buffer.from('ahoj!')))).toThrow(expect.objectContaining({ reason: 'output-too-large' }));
  });
});
