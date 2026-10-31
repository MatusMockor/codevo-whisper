import { NativeEventEmitter, Platform, TurboModuleRegistry, type TurboModule } from 'react-native';
import type { OpenWire } from './core/connection';
import type { PairingVault } from './core/pairing';

interface VoiceNative extends TurboModule {
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  loadPairing(): Promise<string | null>;
  savePairing(value: string): Promise<void>;
  removePairing(): Promise<void>;
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
export const vault: PairingVault = {
  load: () => native.loadPairing(),
  save: (value) => native.savePairing(value),
  remove: () => native.removePairing(),
};
export const openWire: OpenWire = (endpoint) => {
  if (new URL(endpoint).protocol !== 'wss:' && Platform.OS === 'ios') {
    throw new Error('Use a wss:// server endpoint on iPhone');
  }
  const socket = new WebSocket(endpoint);
  socket.binaryType = 'arraybuffer';
  return {
    get bufferedAmount() {
      return socket.bufferedAmount;
    },
    send: (bytes) => socket.send(bytes),
    close: () => socket.close(),
    subscribe: (events) => {
      socket.onopen = () => events.open();
      socket.onmessage = (event) => events.frame(event.data);
      socket.onerror = () => events.failed();
      socket.onclose = (event) => events.closed(event.code ?? 1006);
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
