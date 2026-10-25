import type { CaptureMode } from '../../shared/capture-contract';
import { concatPcm, PCM_BYTES_PER_SECOND } from '../../shared/pcm';
import type { MicrophoneSetting } from '../../shared/settings';
import { Listeners } from '../helper/listeners';
import type { Logger } from '../logging/logger';
import type { AudioCapture, CaptureStart } from './audio-capture';
import type { CaptureHost } from './capture-host';
import { parseDeviceList, parseStartResult } from './capture-payloads';
import { resolveDevice, toAudioDevices, type AudioDevice } from './device-resolver';

const MAX_RECORDING_BYTES = PCM_BYTES_PER_SECOND * 130;

type Mode = 'idle' | CaptureMode;

export class WindowAudioCapture implements AudioCapture {
  private mode: Mode = 'idle';
  private frames: Uint8Array[] = [];
  private recordedBytes = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly levels: Listeners<number>;
  private readonly devices: Listeners<AudioDevice[]>;

  constructor(
    private readonly host: CaptureHost,
    private readonly logger: Logger,
  ) {
    this.levels = new Listeners(logger, 'A microphone level listener failed');
    this.devices = new Listeners(logger, 'A microphone list listener failed');
    host.onFrame((pcm) => {
      this.keep(pcm);
    });
    host.onLevel((rms) => {
      if (this.mode === 'idle') {
        return;
      }
      this.levels.emit(rms);
    });
    host.onDevices((raw) => {
      this.devices.emit(toAudioDevices(raw));
    });
  }

  async listDevices(): Promise<AudioDevice[]> {
    return toAudioDevices(parseDeviceList(await this.host.request({ type: 'list-devices' })));
  }

  onDevicesChanged(listener: (devices: AudioDevice[]) => void): () => void {
    const remove = this.devices.add(listener);
    this.host.watchDevices();
    return remove;
  }

  onLevel(listener: (rms: number) => void): () => void {
    return this.levels.add(listener);
  }

  start(chosen: MicrophoneSetting): Promise<CaptureStart> {
    return this.serialize(() => this.startRecording(chosen));
  }

  stop(): Promise<Uint8Array> {
    return this.serialize(() => this.stopRecording());
  }

  startMeter(chosen: MicrophoneSetting): Promise<void> {
    return this.serialize(() => this.startMetering(chosen));
  }

  stopMeter(): Promise<void> {
    return this.serialize(() => this.stopMetering());
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async startRecording(chosen: MicrophoneSetting): Promise<CaptureStart> {
    if (this.mode === 'record') {
      throw new Error('Recording is already running');
    }
    await this.stopMetering();
    this.frames = [];
    this.recordedBytes = 0;
    return this.open(chosen, 'record');
  }

  private async stopRecording(): Promise<Uint8Array> {
    if (this.mode !== 'record') {
      return new Uint8Array(0);
    }
    await this.closeStream();
    this.mode = 'idle';
    const pcm = concatPcm(this.frames);
    this.frames = [];
    this.recordedBytes = 0;
    return pcm;
  }

  private async startMetering(chosen: MicrophoneSetting): Promise<void> {
    if (this.mode === 'record') {
      return;
    }
    await this.stopMetering();
    await this.open(chosen, 'meter');
  }

  private async stopMetering(): Promise<void> {
    if (this.mode !== 'meter') {
      return;
    }
    await this.closeStream();
    this.mode = 'idle';
  }

  private async open(chosen: MicrophoneSetting, mode: CaptureMode): Promise<CaptureStart> {
    const { device, fallback } = resolveDevice(await this.listDevices(), chosen);
    this.mode = mode;
    try {
      const started = parseStartResult(await this.host.request({ type: 'start', deviceId: device?.deviceId ?? null, mode }));
      return { fallback, deviceLabel: started.label };
    } catch (error) {
      await this.closeStream();
      this.mode = 'idle';
      throw error;
    }
  }

  private async closeStream(): Promise<void> {
    try {
      await this.host.request({ type: 'stop' });
    } catch (error) {
      this.logger.error('The capture window did not release the microphone, discarding it', error);
      this.host.discard();
    }
  }

  private keep(pcm: Uint8Array): void {
    if (this.mode !== 'record' || this.recordedBytes + pcm.byteLength > MAX_RECORDING_BYTES) {
      return;
    }
    this.frames.push(pcm);
    this.recordedBytes += pcm.byteLength;
  }
}
