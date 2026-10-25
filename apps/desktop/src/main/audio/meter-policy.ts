import type { MicrophoneSetting } from '../../shared/settings';
import type { Logger } from '../logging/logger';
import type { MicrophoneMeter } from './microphone-meter';

export type MeterWindow = {
  isActive(): boolean;
  onActivityChange(listener: (active: boolean) => void): () => void;
  onClose(listener: () => void): () => void;
};

export type RecordingStops = { onRecordingStopped(listener: () => void): () => void };

export type MeterPolicyDeps = {
  meter: Pick<MicrophoneMeter, 'start' | 'stop'>;
  window: MeterWindow;
  recordings: RecordingStops;
  logger: Logger;
};

export class MeterPolicy {
  private wanted: MicrophoneSetting | null = null;
  private running = false;
  private readonly unsubscribers: Array<() => void>;

  constructor(private readonly deps: MeterPolicyDeps) {
    this.unsubscribers = [
      deps.window.onActivityChange(() => this.resync()),
      deps.window.onClose(() => {
        this.wanted = null;
        this.resync();
      }),
      deps.recordings.onRecordingStopped(() => {
        this.running = false;
        this.resync();
      }),
    ];
  }

  request(microphone: MicrophoneSetting): Promise<void> {
    this.wanted = microphone;
    this.running = false;
    return this.sync();
  }

  release(): Promise<void> {
    this.wanted = null;
    return this.sync();
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
  }

  private resync(): void {
    this.sync().catch((error: unknown) => {
      this.deps.logger.error('The microphone meter could not follow the main window', error);
    });
  }

  private sync(): Promise<void> {
    const microphone = this.wanted;
    if (microphone !== null && this.deps.window.isActive()) {
      return this.start(microphone);
    }
    if (!this.running) {
      return Promise.resolve();
    }
    this.running = false;
    return this.deps.meter.stop();
  }

  private start(microphone: MicrophoneSetting): Promise<void> {
    if (this.running) {
      return Promise.resolve();
    }
    this.running = true;
    return this.deps.meter.start(microphone).catch((error: unknown) => {
      this.running = false;
      throw error;
    });
  }
}
