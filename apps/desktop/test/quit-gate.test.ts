import { describe, expect, it } from 'vitest';
import { QuitGate } from '../src/main/app/quit-gate';
import { WindowAudioCapture } from '../src/main/audio/window-audio-capture';
import type { CaptureRequest } from '../src/shared/capture-contract';
import { FakeCaptureHost } from './fake-capture-host';
import { RecordingLogger } from './recording-logger';

class SlowCaptureHost extends FakeCaptureHost {
  readonly startGate = Promise.withResolvers<void>();

  override async request(request: CaptureRequest): Promise<unknown> {
    if (request.type === 'start') {
      await this.startGate.promise;
    }
    return super.request(request);
  }
}

class QuitEvent {
  prevented = 0;

  preventDefault(): void {
    this.prevented += 1;
  }
}

function harness(timeoutMs = 2000) {
  const host = new SlowCaptureHost();
  const capture = new WindowAudioCapture(host, new RecordingLogger());
  let quits = 0;
  const gate = new QuitGate(capture, () => (quits += 1), new RecordingLogger(), timeoutMs);
  return { host, capture, gate, quits: () => quits };
}

describe('QuitGate', () => {
  it('lets the quit through when the microphone is idle', () => {
    const { gate, quits } = harness();
    const event = new QuitEvent();

    gate.handle(event);

    expect(event.prevented).toBe(0);
    expect(quits()).toBe(0);
  });

  it('defers the quit until the microphone finished starting and then quits once', async () => {
    const { host, capture, gate, quits } = harness();
    const meter = capture.startMeter({ deviceId: null, label: null });
    const first = new QuitEvent();
    const second = new QuitEvent();

    gate.handle(first);
    gate.handle(second);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect([first.prevented, second.prevented, quits()]).toEqual([1, 1, 0]);

    host.startGate.resolve();
    await meter;
    await expect.poll(quits).toBe(1);

    const after = new QuitEvent();
    gate.handle(after);
    expect(after.prevented).toBe(0);
  });

  it('quits anyway when the microphone does not settle in time', async () => {
    const { capture, gate, quits } = harness(30);
    void capture.startMeter({ deviceId: null, label: null });
    const event = new QuitEvent();

    gate.handle(event);

    expect(event.prevented).toBe(1);
    await expect.poll(quits).toBe(1);
  });

  it('never holds the quit back while the system shuts down or logs out', async () => {
    const { capture, gate, quits } = harness();
    void capture.startMeter({ deviceId: null, label: null });
    const event = new QuitEvent();

    gate.systemShuttingDown();
    gate.handle(event);

    expect(event.prevented).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(quits()).toBe(0);
  });
});
