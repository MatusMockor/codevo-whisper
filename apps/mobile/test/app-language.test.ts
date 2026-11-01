import { act, createElement } from 'react';
import { Pressable } from 'react-native';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { base64 } from '@scure/base';
import { createHandshake, decodeClientMessage, decodeOpeningFrame, encodeServerMessage, generateKeyPair, PROLOGUE_SESSION, SecureTransport, type Language } from '@codevo-whisper/protocol';
import { serializePairing } from '../src/core/pairing';

const bridge = vi.hoisted(() => {
  const listeners = new Set<{ name: string; receive(value: unknown): void }>();
  const foreground = new Set<(state: string) => void>();
  const settings = { language: 'auto', snapshot: 'auto' };
  const voice = {
    loadPairing: vi.fn<() => Promise<string | null>>(),
    getLanguage: vi.fn<() => Promise<unknown>>(() => Promise.resolve(settings.language)),
    setupStatus: vi.fn(() => Promise.resolve({ microphone: true, keyboard: 'selected' })),
    setLanguage: vi.fn((value: string) => {
      settings.language = value;
      for (const listener of listeners) if (listener.name === 'CodevoLanguageChanged') listener.receive(value);
      return Promise.resolve();
    }),
    beginCompanion: vi.fn(() => { settings.snapshot = settings.language; return Promise.resolve('companion'); }),
    runLanguage: vi.fn(() => Promise.resolve(settings.snapshot)),
    ready: vi.fn(() => Promise.resolve(true)), capture: vi.fn(() => Promise.resolve()),
    stopCapture: vi.fn(() => Promise.resolve()), terminal: vi.fn(() => Promise.resolve()),
    complete: vi.fn(() => Promise.resolve(true)), acknowledge: vi.fn(),
  };
  const socket = { connect: vi.fn(() => Promise.resolve()), send: vi.fn<(id: string, data: string) => Promise<void>>(), close: vi.fn() };
  return { listeners, foreground, settings, voice, socket };
});
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Alert: {}, Linking: {},
  Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
  StyleSheet: { create: (styles: unknown) => styles }, Platform: { OS: 'android' },
  PermissionsAndroid: { PERMISSIONS: { RECORD_AUDIO: 'microphone' }, RESULTS: { GRANTED: 'granted' }, request: () => Promise.resolve('granted') },
  AppState: { addEventListener: (_name: string, receive: (state: string) => void) => {
    bridge.foreground.add(receive);
    return { remove: () => bridge.foreground.delete(receive) };
  } },
  TurboModuleRegistry: { getEnforcing: (name: string) => name === 'CodevoVoice' ? bridge.voice : bridge.socket },
  NativeEventEmitter: class {
    addListener(name: string, receive: (value: unknown) => void) {
      const listener = { name, receive };
      bridge.listeners.add(listener);
      return { remove: () => bridge.listeners.delete(listener) };
    }
  },
}));
import { App } from '../src/App';
import { subscribeLanguage } from '../src/platform';

let app: ReactTestRenderer | undefined;
const starts: Language[] = [];
function emit(name: string, value: unknown) {
  for (const listener of bridge.listeners) if (listener.name === name) listener.receive(value);
}
function keyboardLanguage(value: string) {
  bridge.settings.language = value;
  emit('CodevoLanguageChanged', value);
}
function screen() {
  if (app === undefined) throw new Error('App not mounted');
  return app.root;
}
function radio(label: string): ReactTestInstance {
  const node = screen().findAllByType(Pressable).find((node) => node.findAllByProps({ children: label }).length > 0);
  if (node === undefined) throw new Error(`Missing language ${label}`);
  return node;
}
function selected(label: string) {
  const state: unknown = radio(label).props.accessibilityState;
  if (typeof state !== 'object' || state === null || !('selected' in state)) throw new Error('Missing radio state');
  return state.selected;
}
async function press(label: string) {
  const node = screen().findAllByType(Pressable).find((node) => node.findAllByProps({ children: label }).length > 0);
  if (node === undefined) throw new Error(`Missing button ${label}`);
  expect(node.props.disabled).toBeFalsy();
  const onPress: unknown = node.props.onPress;
  if (typeof onPress !== 'function') throw new Error('Missing press action');
  await act(() => Promise.resolve(Reflect.apply(onPress, undefined, [])));
}
async function mount() { await act(() => { app = create(createElement(App)); return Promise.resolve(); }); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  bridge.settings.language = 'auto';
  bridge.settings.snapshot = 'auto';
  starts.length = 0;
  const server = generateKeyPair();
  bridge.voice.loadPairing.mockResolvedValue(serializePairing({ deviceKey: generateKeyPair(), serverPublicKey: server.publicKey, endpoint: 'wss://example.invalid', deviceId: 'test-device' }));
  let transport: SecureTransport | undefined;
  bridge.socket.send.mockImplementation((id, data) => {
    const respond = (bytes: Uint8Array) => { void Promise.resolve().then(() => emit('CodevoSocketEvent', { id, type: 'frame', data: base64.encode(bytes) })); };
    const bytes = base64.decode(data);
    if (transport === undefined) {
      const handshake = createHandshake({ pattern: 'IK', initiator: false, staticKey: server, prologue: PROLOGUE_SESSION });
      handshake.readMessage(decodeOpeningFrame(bytes).noiseMessage);
      respond(handshake.writeMessage(new Uint8Array()));
      transport = new SecureTransport(handshake.result());
      return Promise.resolve();
    }
    const message = decodeClientMessage(transport.open(bytes));
    if (message.type === 'hello') respond(transport.seal(encodeServerMessage({ type: 'ready', serverVersion: 'test' })));
    if (message.type === 'start') starts.push(message.language);
    return Promise.resolve();
  });
});
afterEach(async () => {
  await act(() => {
    emit('CodevoVoiceEvent', { type: 'cancel', runId: 'companion' });
    app?.unmount();
    return Promise.resolve();
  });
  app = undefined;
  vi.unstubAllGlobals();
});

it('shows a foreground keyboard selection in the mounted companion and sends the same language on Record', async () => {
  await mount();
  expect(selected('Auto')).toBe(true);
  await press('Pairing settings');
  expect(screen().findByProps({ accessibilityLabel: 'Device name' })).toBeDefined();
  await act(() => Promise.resolve(keyboardLanguage('sk')));
  expect(selected('Slovak')).toBe(true);
  expect(selected('Auto')).toBe(false);
  await press('Record');
  expect(starts).toEqual(['sk']);
  expect(radio('Slovak').props.disabled).toBe(true);
});

it.each(['mount', 'foreground'])('keeps the newer keyboard selection when a stale %s read resolves', async (phase) => {
  let resolveRead: (value: unknown) => void = () => { throw new Error('Read not started'); };
  const delayRead = () => bridge.voice.getLanguage.mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }));
  if (phase === 'mount') delayRead();
  await mount();
  if (phase === 'foreground') {
    delayRead();
    await act(() => {
      for (const receive of bridge.foreground) receive('active');
      return Promise.resolve();
    });
  }
  await act(() => Promise.resolve(keyboardLanguage('sk')));
  expect(selected('Slovak')).toBe(true);
  await act(() => Promise.resolve(resolveRead('auto')));
  expect(selected('Slovak')).toBe(true);
  await press('Record');
  expect(starts).toEqual(['sk']);
});

it('uses authoritative companion events and ignores an older setter completion', async () => {
  await mount();
  let complete: () => void = () => { throw new Error('Setter not started'); };
  bridge.voice.setLanguage.mockImplementationOnce((value) => {
    keyboardLanguage(value);
    return new Promise<void>((resolve) => { complete = resolve; });
  });
  await press('English');
  expect(selected('English')).toBe(true);
  await act(() => Promise.resolve(keyboardLanguage('cs')));
  await act(() => Promise.resolve(complete()));
  expect(selected('Czech')).toBe(true);
});

it('reports malformed settings without changing language or cancelling an active recording', async () => {
  await mount();
  await press('Slovak');
  await press('Record');
  await act(() => {
    emit('CodevoLanguageChanged', 'sk');
    for (const invalid of ['de', null, { language: 'en' }, 1]) emit('CodevoLanguageChanged', invalid);
    return Promise.resolve();
  });
  expect(selected('Slovak')).toBe(true);
  expect(starts).toEqual(['sk']);
  expect(screen().findByProps({ accessibilityLiveRegion: 'polite' }).props.children).toEqual(['Recording', '…']);
  expect(screen().findByProps({ children: 'Voice language could not be read. Reopen Codevo Voice.' })).toBeDefined();
});

it('stops delivering settings and malformed payloads after unsubscribing', () => {
  const values: Language[] = [];
  const errors: string[] = [];
  const unsubscribe = subscribeLanguage((value) => values.push(value), () => errors.push('invalid'));
  emit('CodevoLanguageChanged', 'sk');
  unsubscribe();
  emit('CodevoLanguageChanged', 'en');
  emit('CodevoLanguageChanged', null);
  expect(values).toEqual(['sk']);
  expect(errors).toEqual([]);
});
