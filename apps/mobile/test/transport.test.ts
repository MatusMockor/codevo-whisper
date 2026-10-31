import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { base64 } from '@scure/base';
import { MobileSession } from '../src/core/session';

const bridge = vi.hoisted(() => {
  const pending: { resolve(): void; reject(error: Error): void }[] = [];
  const frames: string[] = [];
  const listeners = new Set<(value: unknown) => void>();
  const socket = {
    connect: vi.fn(async () => undefined),
    send: vi.fn((_id: string, data: string) => {
      frames.push(data);
      return new Promise<void>((resolve, reject) => pending.push({ resolve, reject }));
    }),
    close: vi.fn(), addListener: vi.fn(), removeListeners: vi.fn(),
  };
  return { socket, pending, frames, listeners };
});
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  TurboModuleRegistry: { getEnforcing: () => bridge.socket },
  NativeEventEmitter: class {
    addListener(_name: string, receive: (value: unknown) => void) {
      bridge.listeners.add(receive);
      return { remove: () => bridge.listeners.delete(receive) };
    }
  },
}));
import { openWire } from '../src/platform';

beforeEach(() => {
  vi.useFakeTimers();
  bridge.pending.length = 0;
  bridge.frames.length = 0;
  bridge.listeners.clear();
  vi.clearAllMocks();
  vi.stubGlobal('WebSocket', class {
    binaryType = '';
    onopen: (() => void) | undefined;
    constructor() { void Promise.resolve().then(() => this.onopen?.()); }
    send(bytes: Uint8Array) { bridge.frames.push(base64.encode(bytes)); }
    close() { bridge.socket.close(); }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('bounds a stalled native uplink through the public mobile session and ignores late completion', async () => {
  const wire = openWire('wss://example.invalid');
  let fail: (error: Error) => void = () => undefined;
  const session = new MobileSession({
    get bufferedAmount() { return wire.bufferedAmount; },
    send(message) { if (message.type === 'audio') wire.send(message.pcm); },
    close: () => wire.close(),
    listen(_receive, failed) { fail = failed; },
  }, 'stall', 'auto');
  wire.subscribe({ open() {}, frame() {}, failed() { fail(new Error('Transport failed')); }, closed() {} });
  await Promise.resolve();
  for (let i = 0; i < 131; i++) {
    session.push(new Uint8Array(3200));
    await vi.advanceTimersByTimeAsync(100);
  }
  expect(bridge.frames.reduce((size, frame) => size + base64.decode(frame).length, 0)).toBeLessThanOrEqual(64_000);
  await expect(session.completion).rejects.toThrow();
  expect(bridge.socket.close).toHaveBeenCalled();
  const sent = bridge.frames.length;
  for (const pending of bridge.pending) pending.resolve();
  await vi.advanceTimersByTimeAsync(100);
  expect(bridge.frames).toHaveLength(sent);
});

it('reserves bridge bytes until native drain completion and sends frames in order', async () => {
  const wire = openWire('wss://example.invalid');
  wire.subscribe({ open() {}, frame() {}, failed() {}, closed() {} });
  await Promise.resolve();
  wire.send(Uint8Array.of(1, 2));
  wire.send(Uint8Array.of(3, 4));
  expect(wire.bufferedAmount).toBe(4);
  expect(bridge.frames.map((frame) => [...base64.decode(frame)])).toEqual([[1, 2]]);
  bridge.pending[0]?.resolve();
  await Promise.resolve();
  expect(wire.bufferedAmount).toBe(2);
  expect(bridge.frames.map((frame) => [...base64.decode(frame)])).toEqual([[1, 2], [3, 4]]);
  wire.close();
});

it('closes connecting sockets and suppresses late open and send callbacks', async () => {
  let connected: () => void = () => undefined;
  bridge.socket.connect.mockImplementationOnce(() => new Promise<void>((resolve) => { connected = resolve; }));
  const opened = vi.fn();
  const wire = openWire('wss://example.invalid');
  wire.subscribe({ open: opened, frame() {}, failed() {}, closed() {} });
  wire.close();
  connected();
  await Promise.resolve();
  expect(opened).not.toHaveBeenCalled();
  expect(bridge.socket.close).toHaveBeenCalled();
});
