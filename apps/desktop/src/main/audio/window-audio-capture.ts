import type { CaptureMode } from '../../shared/capture-contract';
import { PCM_BYTES_PER_SAMPLE, PCM_BYTES_PER_SECOND } from '../../shared/pcm';
import type { MicrophoneSetting } from '../../shared/settings';
import { Listeners } from '../helper/listeners';
import type { Logger } from '../logging/logger';
import type { AudioCapture, CaptureStart } from './audio-capture';
import type { CaptureHost } from './capture-host';
import { parseDeviceList, parseStartResult } from './capture-payloads';
import { resolveDevice, toAudioDevices, type AudioDevice } from './device-resolver';
import { PcmRecording } from './pcm-recording';

export const MAX_RECORDING_MS = 600_000;

export type WindowAudioCaptureOptions = { maxRecordingMs?: number };

type Mode = 'idle' | CaptureMode;

function recordingBytes(maxRecordingMs: number): number {
  const samples = Math.floor((maxRecordingMs * PCM_BYTES_PER_SECOND) / 1000 / PCM_BYTES_PER_SAMPLE);
  return samples * PCM_BYTES_PER_SAMPLE;
}

export class WindowAudioCapture implements AudioCapture {
  private mode: Mode = 'idle';
  private readonly recording: PcmRecording;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly levels: Listeners<number>;
  private readonly devices: Listeners<AudioDevice[]>;
  private readonly limits: Listeners<void>;
  private readonly recordingStops: Listeners<void>;

  constructor(
    private readonly host: CaptureHost,
    private readonly logger: Logger,
    options: WindowAudioCaptureOptions = {},
  ) {
    this.recording = new PcmRecording(recordingBytes(options.maxRecordingMs ?? MAX_RECORDING_MS));
    this.levels = new Listeners(logger, 'A microphone level listener failed');
    this.devices = new Listeners(logger, 'A microphone list listener failed');
    this.limits = new Listeners(logger, 'A recording limit listener failed');
    this.recordingStops = new Listeners(logger, 'A recording stop listener failed');
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
    return toAudioDevices(parseDeviceList(await this.track(this.host.request({ type: 'list-devices' }))));
  }

  isBusy(): boolean {
    return this.inFlight.size > 0;
  }

  async settled(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  onDevicesChanged(listener: (devices: AudioDevice[]) => void): () => void {
    const remove = this.devices.add(listener);
    this.host.watchDevices();
    return remove;
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

  private track<T>(work: Promise<T>): Promise<T> {
    const tracked: Promise<T> = work.finally(() => {
      this.inFlight.delete(tracked);
    });
    this.inFlight.add(tracked);
    return tracked;
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.track(this.queue.then(task));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async startRecording(chosen: MicrophoneSetting): Promise<CaptureStart> {
    if (this.mode === 'record') {
      throw new Error('Recording is already running');
    }
    await this.stopMetering();
    this.recording.clear();
    try {
      return await this.open(chosen, 'record');
    } catch (error) {
      this.recordingStops.emit(undefined);
      throw error;
    }
  }

  private async stopRecording(): Promise<Uint8Array> {
    if (this.mode !== 'record') {
      return new Uint8Array(0);
    }
    await this.closeStream();
    this.mode = 'idle';
    const pcm = this.recording.take();
    this.recordingStops.emit(undefined);
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
      return { fallback: fallback || started.fallback, deviceLabel: started.label };
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
    if (this.mode !== 'record' || this.recording.append(pcm) !== 'limit-reached') {
      return;
    }
    this.limits.emit(undefined);
  }
}
