import { NativeEventEmitter, Platform, TurboModuleRegistry, type TurboModule } from 'react-native';
import { base64 } from '@scure/base';
import type { OpenWire } from './core/connection';
import type { PairingVault } from './core/pairing';
import type { PairingScanNative } from './core/pairing-scanner';
import { parseLanguage } from './core/settings';
import type { Language } from '@codevo-whisper/protocol';

interface PairingScannerNative extends TurboModule, PairingScanNative {}
export const pairingScannerNative = TurboModuleRegistry.getEnforcing<PairingScannerNative>('CodevoPairingScanner');

interface VoiceNative extends TurboModule {
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  loadPairing(): Promise<string | null>;
  savePairing(value: string): Promise<void>;
  removePairing(): Promise<void>;
  getLanguage(): Promise<unknown>;
  setLanguage(value: string): Promise<void>;
  runLanguage(runId: string): Promise<unknown>;
  setupStatus(): Promise<unknown>;
  beginCompanion(): Promise<string>;
  ready(runId: string): Promise<boolean>;
  capture(runId: string): Promise<void>;
  stopCapture(runId: string): Promise<void>;
  acknowledge(runId: string, sequence: number): void;
  complete(runId: string, text: string): Promise<boolean>;
  terminal(runId: string, message: string): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  keyboardSettings(): Promise<void>;
  switchKeyboard(): Promise<void>;
  requestMicrophone?(): Promise<boolean>;
}
export const native = TurboModuleRegistry.getEnforcing<VoiceNative>('CodevoVoice');
export function subscribeLanguage(receive: (language: Language) => void, fail: () => void): () => void {
  const subscription = new NativeEventEmitter(native).addListener('CodevoLanguageChanged', (value: unknown) => {
    try {
      receive(parseLanguage(value));
    } catch {
      fail();
    }
  });
  return () => subscription.remove();
}
export const vault: PairingVault = {
  load: () => native.loadPairing(),
  save: (value) => native.savePairing(value),
  remove: () => native.removePairing(),
};
interface SocketNative extends TurboModule {
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  connect(id: string, endpoint: string): Promise<void>;
  send(id: string, data: string): Promise<void>;
  close(id: string): void;
}
const socketNative = TurboModuleRegistry.getEnforcing<SocketNative>('CodevoSocket');
let nextSocket = 0;
export const openWire: OpenWire = (endpoint) => {
  if (new URL(endpoint).protocol !== 'wss:' && Platform.OS === 'ios') {
    throw new Error('Use a wss:// server endpoint on iPhone');
  }
  const id = String(++nextSocket);
  let closed = false;
  let opened = false;
  let sending = false;
  let buffered = 0;
  const queue: Uint8Array[] = [];
  let subscription: { remove(): void } | undefined;
  let events: Parameters<ReturnType<OpenWire>['subscribe']>[0] | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    subscription?.remove();
    queue.length = 0;
    buffered = 0;
    socketNative.close(id);
  };
  const fail = () => {
    if (closed) return;
    close();
    events?.failed();
  };
  const pump = () => {
    if (closed || !opened || sending) return;
    const bytes = queue.shift();
    if (bytes === undefined) return;
    sending = true;
    void socketNative.send(id, base64.encode(bytes)).then(() => {
      if (closed) return;
      buffered -= bytes.length;
      sending = false;
      pump();
    }, fail);
  };
  return {
    get bufferedAmount() { return buffered; },
    send(bytes) {
      if (closed || bytes.length === 0 || bytes.length + buffered > 64_000) {
        fail();
        throw new Error('Socket queue full or closed');
      }
      buffered += bytes.length;
      queue.push(bytes.slice());
      pump();
    },
    close,
    subscribe(receive) {
      if (closed || events !== undefined) throw new Error('Socket already subscribed or closed');
      events = receive;
      subscription = new NativeEventEmitter(socketNative).addListener('CodevoSocketEvent', (value: unknown) => {
        if (closed || typeof value !== 'object' || value === null || !('id' in value) || value.id !== id) return;
        if ('type' in value && value.type === 'frame' && 'data' in value && typeof value.data === 'string' && value.data.length <= 87_380) {
          try {
            const bytes = base64.decode(value.data);
            if (bytes.length > 65_535) throw new Error('Oversized server frame');
            receive.frame(bytes.buffer);
          } catch { fail(); }
          return;
        }
        fail();
      });
      void socketNative.connect(id, endpoint).then(() => {
        if (closed) return;
        opened = true;
        receive.open();
        pump();
      }, fail);
    },
  };
};

export type VoiceEvent =
  | { type: 'stop'; runId: string }
  | { type: 'cancel'; runId: string }
  | { type: 'ended'; runId: string }
  | { type: 'pcm'; runId: string; sequence: number; pcm: string };
function parseEvent(value: unknown): VoiceEvent {
  if (typeof value !== 'object' || value === null || !('runId' in value) || typeof value.runId !== 'string' || !('type' in value)) {
    throw new Error('Invalid audio bridge event');
  }
  if (value.type === 'stop' || value.type === 'cancel' || value.type === 'ended') {
    return { type: value.type, runId: value.runId };
  }
  if (
    value.type === 'pcm' &&
    'sequence' in value &&
    typeof value.sequence === 'number' &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    'pcm' in value &&
    typeof value.pcm === 'string' &&
    value.pcm.length <= 4268
  ) {
    return { type: 'pcm', runId: value.runId, sequence: value.sequence, pcm: value.pcm };
  }
  throw new Error('Invalid audio bridge event');
}
export function subscribeVoice(receive: (event: VoiceEvent) => void, fail: () => void): () => void {
  const subscription = new NativeEventEmitter(native).addListener('CodevoVoiceEvent', (value: unknown) => {
    try {
      receive(parseEvent(value));
    } catch {
      fail();
    }
  });
  return () => subscription.remove();
}
