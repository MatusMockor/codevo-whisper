import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

it('uses canonical pairing tokens and strict JSON without Node or encoding globals', async () => {
  vi.stubGlobal('Buffer', undefined);
  vi.stubGlobal('TextDecoder', undefined);
  vi.spyOn(URL, 'canParse').mockImplementation(() => {
    throw new Error('unavailable');
  });
  const p = await import('../src/index');
  const token = 'cw1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:wss%3A%2F%2Fexample.com';
  expect(p.encodePairingToken(p.parsePairingToken(token))).toBe(token);
  expect(() => p.parsePairingToken(token.replace('AAA:', 'AAB:'))).toThrow();
  expect(p.fingerprint(new Uint8Array())).toBe('6921 7A30 7990 8094 E111 21D0 4235 4A7C');
  const message = { type: 'final', sessionId: 'a', segmentId: 0, text: 'Čau 👋' } as const;
  expect(p.decodeServerMessage(p.encodeServerMessage(message))).toEqual(message);
  expect(() => p.decodeServerMessage(Uint8Array.of(1, 0x7b, 0xc0, 0xaf, 0x7d))).toThrow();
});

it('preserves the UTF-8 decoder behavior for one leading BOM', async () => {
  const p = await import('../src/index');
  const hello = p.encodeClientMessage({ type: 'hello' });
  const frame = Uint8Array.from([1, 0xef, 0xbb, 0xbf, ...hello.subarray(1)]);
  expect(p.decodeClientMessage(frame)).toEqual({ type: 'hello' });
});

it('rejects malformed UTF-8 in public client and server messages without TextDecoder', async () => {
  vi.stubGlobal('TextDecoder', undefined);
  const p = await import('../src/index');
  const malformed = [
    [0x84, 0x8c], [0x80], [0xbf], [0xc0, 0xaf], [0xc1, 0xbf],
    [0xc2], [0xc2, 0x20], [0xe0, 0x80, 0xaf], [0xe1, 0x80],
    [0xed, 0xa0, 0x80], [0xed, 0xbf, 0xbf], [0xf0, 0x80, 0x80, 0xaf],
    [0xf0, 0x90, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf5, 0x80, 0x80, 0x80], [0xff],
  ];
  for (const bytes of malformed) {
    for (const [prefix, decode] of [
      ['{"type":"pair-request","deviceName":"', p.decodeClientMessage],
      ['{"type":"final","sessionId":"s","segmentId":0,"text":"', p.decodeServerMessage],
    ] as const) {
      const frame = Uint8Array.from([1, ...new TextEncoder().encode(prefix), ...bytes, 0x22, 0x7d]);
      expect(() => decode(frame), bytes.map((b) => b.toString(16)).join(' ')).toThrow('valid UTF-8 JSON');
    }
  }
});

it('preserves Unicode scalar boundaries, percent text and exactly one leading BOM', async () => {
  vi.stubGlobal('TextDecoder', undefined);
  const p = await import('../src/index');
  const message = { type: 'final', sessionId: 's', segmentId: 0, text: '\u007f\u0080\u07ff\u0800\ud7ff\ue000\uffff\u{10000}\u{10ffff} Č 👋 100% %84%8c' } as const;
  const frame = p.encodeServerMessage(message);
  expect(p.decodeServerMessage(frame)).toEqual(message);
  expect(p.decodeServerMessage(Uint8Array.from([1, 0xef, 0xbb, 0xbf, ...frame.subarray(1)]))).toEqual(message);
  expect(() => p.decodeServerMessage(Uint8Array.from([1, 0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, ...frame.subarray(1)]))).toThrow();
});
