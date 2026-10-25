import type { CaptureRequest, RawAudioDevice } from '../src/shared/capture-contract';
import type { CaptureHost } from '../src/main/audio/capture-host';

export class FakeCaptureHost implements CaptureHost {
  readonly requests: CaptureRequest[] = [];
  devices: RawAudioDevice[] = [{ deviceId: 'built-in-id', label: 'MacBook Pro Microphone' }];
  startResult: unknown = { label: 'MacBook Pro Microphone', fallback: false };
  private readonly frameListeners = new Set<(pcm: Uint8Array) => void>();

  request(request: CaptureRequest): Promise<unknown> {
    this.requests.push(request);
    if (request.type === 'list-devices') {
      return Promise.resolve(this.devices);
    }
    if (request.type === 'start') {
      return Promise.resolve(this.startResult);
    }
    return Promise.resolve(null);
  }

  watchDevices(): void {}

  discard(): void {}

  onFrame(listener: (pcm: Uint8Array) => void): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  onLevel(): () => void {
    return () => undefined;
  }

  onDevices(): () => void {
    return () => undefined;
  }

  emitFrame(bytes: number): void {
    for (const listener of this.frameListeners) {
      listener(new Uint8Array(bytes));
    }
  }
}
