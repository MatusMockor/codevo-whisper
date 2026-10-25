import type { AudioCapture, CaptureStart } from '../src/main/audio/audio-capture';
import { resolveDevice, type AudioDevice } from '../src/main/audio/device-resolver';
import { Listeners } from '../src/main/helper/listeners';
import { concatPcm, PCM_BYTES_PER_SECOND, PCM_SAMPLE_RATE } from '../src/shared/pcm';
import type { MicrophoneSetting } from '../src/shared/settings';
import { RecordingLogger } from './recording-logger';

export const BUILT_IN: AudioDevice = { deviceId: 'built-in', label: 'MacBook Pro Microphone', isBluetooth: false, isDefault: false };

export function stampedPcm(marker: number, seconds = 1): Uint8Array {
  const pcm = new Uint8Array(seconds * PCM_BYTES_PER_SECOND);
  const view = new DataView(pcm.buffer);
  for (let sample = 0; sample < seconds * PCM_SAMPLE_RATE; sample += 1) {
    view.setInt16(sample * 2, marker, true);
  }
  return pcm;
}

export class InProcessCapture implements AudioCapture {
  devices: AudioDevice[] = [BUILT_IN];
  failNextStart = false;
  failureDelayMs = 0;
  recording = false;
  metering: MicrophoneSetting | null = null;
  readonly starts: MicrophoneSetting[] = [];
  private frames: Uint8Array[] = [];
  private readonly frameListeners = new Listeners<Uint8Array>(new RecordingLogger(), 'In-process frame listener failed');
  private readonly levels = new Listeners<number>(new RecordingLogger(), 'In-process level listener failed');
  private readonly limits = new Listeners<void>(new RecordingLogger(), 'In-process limit listener failed');
  private readonly recordingStops = new Listeners<void>(new RecordingLogger(), 'In-process recording stop listener failed');

  listDevices(): Promise<AudioDevice[]> {
    return Promise.resolve([...this.devices]);
  }

  onDevicesChanged(): () => void {
    return () => undefined;
  }

  start(chosen: MicrophoneSetting): Promise<CaptureStart> {
    this.starts.push(chosen);
    if (this.failNextStart) {
      this.failNextStart = false;
      return new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('NotAllowedError: Permission denied')), this.failureDelayMs);
      });
    }
    if (this.recording) {
      return Promise.reject(new Error('Recording is already running'));
    }
    this.recording = true;
    this.metering = null;
    this.frames = [];
    const { device, fallback } = resolveDevice(this.devices, chosen);
    return Promise.resolve({ fallback, deviceLabel: device?.label ?? BUILT_IN.label });
  }

  stop(): Promise<Uint8Array> {
    if (!this.recording) {
      return Promise.resolve(new Uint8Array(0));
    }
    this.recording = false;
    this.recordingStops.emit(undefined);
    return Promise.resolve(concatPcm(this.frames));
  }

  speak(pcm: Uint8Array, level = 0.2): void {
    if (this.metering !== null) {
      this.levels.emit(level);
      return;
    }
    if (!this.recording) {
      return;
    }
    this.frames.push(pcm);
    this.frameListeners.emit(pcm);
    this.levels.emit(level);
  }

  reachLimit(): void {
    this.limits.emit(undefined);
  }

  onFrame(listener: (pcm: Uint8Array) => void): () => void {
    return this.frameListeners.add(listener);
  }

  onLevel(listener: (rms: number) => void): () => void {
    return this.levels.add(listener);
  }

  onLimitReached(listener: () => void): () => void {
    return this.limits.add(listener);
  }

  onRecordingStopped(listener: () => void): () => void {
    return this.recordingStops.add(listener);
  }

  startMeter(chosen: MicrophoneSetting): Promise<void> {
    if (!this.recording) {
      this.metering = chosen;
    }
    return Promise.resolve();
  }

  stopMeter(): Promise<void> {
    this.metering = null;
    return Promise.resolve();
  }
}
