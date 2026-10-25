import { describe, expect, it } from 'vitest';
import { MeterPolicy, type MeterWindow } from '../src/main/audio/meter-policy';
import { MicrophoneMeter } from '../src/main/audio/microphone-meter';
import { Listeners } from '../src/main/helper/listeners';
import { InProcessCapture } from './in-process-capture';
import { RecordingLogger } from './recording-logger';

const AIRPODS = { deviceId: 'airpods', label: 'AirPods Pro' };

class MainWindowActivity implements MeterWindow {
  private readonly changes = new Listeners<boolean>(new RecordingLogger(), 'Window activity listener failed');

  constructor(private active: boolean) {}

  isActive(): boolean {
    return this.active;
  }

  onActivityChange(listener: (active: boolean) => void): () => void {
    return this.changes.add(listener);
  }

  set(active: boolean): void {
    this.active = active;
    this.changes.emit(active);
  }
}

function harness(active = true) {
  const capture = new InProcessCapture();
  const window = new MainWindowActivity(active);
  const policy = new MeterPolicy({ meter: new MicrophoneMeter(capture, () => undefined), window, recordings: capture, logger: new RecordingLogger() });
  return { capture, window, policy };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('MeterPolicy', () => {
  it('opens the microphone only while the settings page asks and the main window is active', async () => {
    const { capture, window, policy } = harness();

    await policy.request(AIRPODS);
    expect(capture.metering).toEqual(AIRPODS);

    window.set(false);
    await settle();
    expect(capture.metering).toBeNull();

    window.set(true);
    await settle();
    expect(capture.metering).toEqual(AIRPODS);

    await policy.release();
    expect(capture.metering).toBeNull();
    window.set(false);
    window.set(true);
    await settle();
    expect(capture.metering).toBeNull();
  });

  it('waits for the window to become active when asked in the background', async () => {
    const { capture, window, policy } = harness(false);

    await policy.request(AIRPODS);
    expect(capture.metering).toBeNull();

    window.set(true);
    await settle();
    expect(capture.metering).toEqual(AIRPODS);
  });

  it('resumes the meter after a dictation ends while the window is active', async () => {
    const { capture, window, policy } = harness();
    await policy.request(AIRPODS);

    await capture.start({ deviceId: null, label: null });
    expect(capture.metering).toBeNull();
    await capture.stop();
    await settle();
    expect(capture.metering).toEqual(AIRPODS);

    window.set(false);
    await capture.start({ deviceId: null, label: null });
    await capture.stop();
    await settle();
    expect(capture.metering).toBeNull();
  });

  it('switches to another microphone', async () => {
    const { capture, policy } = harness();

    await policy.request(AIRPODS);
    await policy.request({ deviceId: null, label: null });

    expect(capture.metering).toEqual({ deviceId: null, label: null });
  });
});
