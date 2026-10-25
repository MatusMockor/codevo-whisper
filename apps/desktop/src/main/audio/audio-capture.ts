import type { MicrophoneSetting } from '../../shared/settings';
import type { AudioDevice } from './device-resolver';

export type CaptureStart = { fallback: boolean; deviceLabel: string };

export interface AudioCapture {
  listDevices(): Promise<AudioDevice[]>;
  onDevicesChanged(listener: (devices: AudioDevice[]) => void): () => void;
  start(chosen: MicrophoneSetting): Promise<CaptureStart>;
  stop(): Promise<Uint8Array>;
  onLevel(listener: (rms: number) => void): () => void;
  startMeter(chosen: MicrophoneSetting): Promise<void>;
  stopMeter(): Promise<void>;
}
