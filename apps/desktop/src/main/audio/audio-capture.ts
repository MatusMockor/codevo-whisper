import type { MicrophoneSetting } from '../../shared/settings';
import type { AudioDevice } from '../../shared/microphones';

export type CaptureStart = { fallback: boolean; deviceLabel: string };

export interface AudioCapture {
  listDevices(): Promise<AudioDevice[]>;
  onDevicesChanged(listener: (devices: AudioDevice[]) => void): () => void;
  start(chosen: readonly MicrophoneSetting[]): Promise<CaptureStart>;
  stop(): Promise<Uint8Array>;
  onFrame(listener: (pcm: Uint8Array) => void): () => void;
  onLevel(listener: (rms: number) => void): () => void;
  onLimitReached(listener: () => void): () => void;
  startMeter(chosen: readonly MicrophoneSetting[]): Promise<void>;
  stopMeter(): Promise<void>;
}
