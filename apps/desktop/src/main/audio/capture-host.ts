import type { CaptureRequest, RawAudioDevice } from '../../shared/capture-contract';

export interface CaptureHost {
  request(request: CaptureRequest): Promise<unknown>;
  prewarm(): void;
  watchDevices(): void;
  discard(): void;
  onFrame(listener: (pcm: Uint8Array) => void): () => void;
  onLevel(listener: (rms: number) => void): () => void;
  onDevices(listener: (devices: RawAudioDevice[]) => void): () => void;
}
