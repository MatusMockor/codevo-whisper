import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { base64 } from '@scure/base';
import { createHandshake, decodeClientMessage, decodeOpeningFrame, encodeServerMessage, generateKeyPair, PROLOGUE_SESSION, SecureTransport, type ServerMessage } from '@codevo-whisper/protocol';
import { serializePairing } from '../src/core/pairing';
import { runRecording } from '../src/runtime';
import { MobileSession } from '../src/core/session';

const bridge = vi.hoisted(() => {
  const pending: { resolve(): void; reject(error: Error): void }[] = [];
  const frames: string[] = [];
  const listeners = new Set<{ name: string; receive(value: unknown): void }>();
  const voice = {
    loadPairing: vi.fn<() => Promise<string | null>>(() => Promise.resolve(null)),
    ready: vi.fn(() => Promise.resolve(true)), capture: vi.fn(() => Promise.resolve()),
    stopCapture: vi.fn(() => Promise.resolve()), terminal: vi.fn(() => Promise.resolve()),
    complete: vi.fn(() => Promise.resolve(true)), acknowledge: vi.fn(),
  };
  const socket = {
    connect: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    send: vi.fn((_id: string, data: string) => {
      frames.push(data);
      return new Promise<void>((resolve, reject) => pending.push({ resolve, reject }));
    }),
    close: vi.fn(), addListener: vi.fn(), removeListeners: vi.fn(),
  };
  return { socket, voice, pending, frames, listeners };
});
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  TurboModuleRegistry: { getEnforcing: (name: string) => name === 'CodevoVoice' ? bridge.voice : bridge.socket },
  NativeEventEmitter: class {
    addListener(name: string, receive: (value: unknown) => void) {
      const listener = { name, receive };
      bridge.listeners.add(listener);
      return { remove: () => bridge.listeners.delete(listener) };
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


it('a stalled uplink releases native capture and prevents late editor completion through runRecording', async () => {
  const server = generateKeyPair();
  bridge.voice.loadPairing.mockResolvedValue(serializePairing({
    deviceKey: generateKeyPair(), serverPublicKey: server.publicKey,
    endpoint: 'wss://example.invalid', deviceId: 'device',
  }));
  const emit = (name: string, value: unknown) => {
    for (const listener of bridge.listeners) if (listener.name === name) listener.receive(value);
  };
  let transport: SecureTransport | undefined;
  let socketId = '';
  const respond = (frame: Uint8Array) => {
    void Promise.resolve().then(() => emit('CodevoSocketEvent', { id: socketId, type: 'frame', data: base64.encode(frame) }));
  };
  const send = (message: ServerMessage) => {
    if (transport !== undefined) respond(transport.seal(encodeServerMessage(message)));
  };
  bridge.socket.send.mockImplementation((id: string, data: string) => {
    socketId = id;
    const bytes = base64.decode(data);
    if (transport === undefined) {
      const handshake = createHandshake({ pattern: 'IK', initiator: false, staticKey: server, prologue: PROLOGUE_SESSION });
      handshake.readMessage(decodeOpeningFrame(bytes).noiseMessage);
      respond(handshake.writeMessage(new Uint8Array()));
      transport = new SecureTransport(handshake.result());
      return Promise.resolve();
    }
    const message = decodeClientMessage(transport.open(bytes));
    if (message.type === 'hello') send({ type: 'ready', serverVersion: 'test' });
    if (message.type === 'audio') return new Promise<void>((resolve, reject) => bridge.pending.push({ resolve, reject }));
    return Promise.resolve();
  });
  const recording = runRecording('stalled-editor', 'auto');
  const result = expect(recording).rejects.toThrow('Server session failed');
  await vi.advanceTimersByTimeAsync(0);
  expect(bridge.voice.capture).toHaveBeenCalledWith('stalled-editor');
  for (let sequence = 0; sequence < 131; sequence++) {
    emit('CodevoVoiceEvent', { type: 'pcm', runId: 'stalled-editor', sequence, pcm: base64.encode(new Uint8Array(3200)) });
    await vi.advanceTimersByTimeAsync(100);
  }
  await result;
  send({ type: 'final', sessionId: 'stalled-editor', segmentId: 0, text: 'late' });
  send({ type: 'done', sessionId: 'stalled-editor' });
  for (const pending of bridge.pending) pending.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(bridge.voice.terminal).toHaveBeenCalledWith('stalled-editor', 'Server session failed');
  expect(bridge.voice.stopCapture).toHaveBeenCalledWith('stalled-editor');
  expect(bridge.voice.complete).not.toHaveBeenCalled();
});
