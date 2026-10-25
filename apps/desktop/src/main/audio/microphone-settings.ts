import type { AudioDevice } from '../../shared/microphones';
import type { MicrophoneSetting } from '../../shared/settings';
import type { AudioCapture } from './audio-capture';
import type { MicrophoneMeter } from './microphone-meter';

export class MicrophoneSettings {
  private unwatch: (() => void) | null = null;

  constructor(
    private readonly capture: Pick<AudioCapture, 'listDevices' | 'onDevicesChanged'>,
    private readonly meter: Pick<MicrophoneMeter, 'start' | 'stop'>,
    private readonly sendDevices: (devices: AudioDevice[]) => void,
  ) {}

  list(): Promise<AudioDevice[]> {
    this.unwatch ??= this.capture.onDevicesChanged((devices) => this.sendDevices(devices));
    return this.capture.listDevices();
  }

  startMeter(microphone: MicrophoneSetting): Promise<void> {
    return this.meter.start(microphone);
  }

  stopMeter(): Promise<void> {
    return this.meter.stop();
  }

  dispose(): void {
    this.unwatch?.();
    this.unwatch = null;
  }
}
