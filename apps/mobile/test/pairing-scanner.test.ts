import { expect, it } from 'vitest';
import { encodePairingToken } from '@codevo-whisper/protocol';
import { PairingScanner, type ScanState } from '../src/core/pairing-scanner';

const token = encodePairingToken({
  serverPublicKey: new Uint8Array(32).fill(1),
  secret: new Uint8Array(32).fill(2),
  endpoint: 'wss://example.invalid/voice',
});

function fixture() {
  let resolve: (result: unknown) => void = () => undefined;
  let field = 'previous manual token';
  const states: ScanState[] = [];
  const scanner = new PairingScanner({
    scan: () => new Promise<unknown>((done) => { resolve = done; }),
    cancel() {},
  }, (state) => states.push(state), (value) => { field = value; });
  return { scanner, states, field: () => field, get finish() { return resolve; } };
}

it('fills a valid CLI token for explicit pairing without starting a connection', async () => {
  const f = fixture();
  const scan = f.scanner.start(false);
  expect(f.scanner.state).toEqual({ kind: 'scanning' });
  f.finish({ kind: 'result', value: token });
  await scan;
  expect(f.field()).toBe(token);
  expect(f.scanner.state).toEqual({ kind: 'result' });
});

it.each([
  'https://example.invalid/not-codevo',
  'cw1:bad:key:wss%3A%2F%2Fexample.invalid',
  token.replace('wss%3A', 'https%3A'),
  token + ':extra',
  token + ' '.repeat(16_384),
])('rejects invalid or non-Codevo QR without changing the existing field', async (value) => {
  const f = fixture();
  const scan = f.scanner.start(false);
  f.finish({ kind: 'result', value });
  await scan;
  expect(f.field()).toBe('previous manual token');
  expect(f.scanner.state).toMatchObject({ kind: 'error', settings: false });
  expect(JSON.stringify(f.scanner.state)).not.toContain(value);
});

it('cancel is quiet, preserves the field, and ignores a late result after a new scan starts', async () => {
  const f = fixture();
  const first = f.scanner.start(false);
  const late = f.finish;
  f.scanner.cancel();
  expect(f.scanner.state).toEqual({ kind: 'idle' });
  expect(f.field()).toBe('previous manual token');
  const second = f.scanner.start(false);
  late({ kind: 'result', value: token });
  f.finish({ kind: 'cancelled' });
  await Promise.all([first, second]);
  expect(f.scanner.state).toEqual({ kind: 'idle' });
  expect(f.field()).toBe('previous manual token');
});

it('does not launch a scanner while pairing or recording, and repeated scan taps accept once', async () => {
  const f = fixture();
  await f.scanner.start(true);
  expect(f.scanner.state).toEqual({ kind: 'idle' });
  const first = f.scanner.start(false);
  await f.scanner.start(false);
  f.finish({ kind: 'result', value: token });
  await first;
  expect(f.field()).toBe(token);
  expect(f.states).toEqual([{ kind: 'scanning' }, { kind: 'result' }]);
});

it.each([
  [{ kind: 'error', reason: 'permission' }, true],
  [{ kind: 'error', reason: 'unavailable' }, false],
  [{ kind: 'result', value: 123 }, false],
  [null, false],
])('offers safe recovery for native failure without echoing scanner data', async (result, settings) => {
  const f = fixture();
  const scan = f.scanner.start(false);
  f.finish(result);
  await scan;
  expect(f.field()).toBe('previous manual token');
  expect(f.scanner.state).toMatchObject({ kind: 'error', settings });
});

it('clears scan feedback when the user edits or submits the filled token', async () => {
  const f = fixture();
  const scan = f.scanner.start(false);
  f.finish({ kind: 'result', value: token });
  await scan;
  f.scanner.clear();
  expect(f.scanner.state).toEqual({ kind: 'idle' });
  expect(f.field()).toBe(token);
});
