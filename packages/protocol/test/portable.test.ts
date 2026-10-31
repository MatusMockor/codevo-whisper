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
