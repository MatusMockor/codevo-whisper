import type { MicrophoneSetting } from '../../shared/settings';
import type { AudioCapture } from './audio-capture';

export class MicrophoneMeter {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly capture: Pick<AudioCapture, 'startMeter' | 'stopMeter' | 'onLevel'>,
    private readonly send: (rms: number) => void,
  ) {}

  async start(microphone: MicrophoneSetting): Promise<void> {
    this.listen();
    try {
      await this.capture.startMeter(microphone);
    } catch (error) {
      this.mute();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.mute();
    await this.capture.stopMeter();
  }

  private listen(): void {
    if (this.unsubscribe !== null) {
      return;
    }
    this.unsubscribe = this.capture.onLevel((rms) => this.send(rms));
  }

  private mute(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
