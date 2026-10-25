import { describe, expect, it } from 'vitest';
import { WindowAudioCapture } from '../src/main/audio/window-audio-capture';
import type { CaptureRequest } from '../src/shared/capture-contract';
import { FakeCaptureHost } from './fake-capture-host';
import { RecordingLogger } from './recording-logger';

const SYSTEM_DEFAULT = { deviceId: null, label: null };

function capture(maxRecordingMs: number): { host: FakeCaptureHost; capture: WindowAudioCapture } {
  const host = new FakeCaptureHost();
  return { host, capture: new WindowAudioCapture(host, new RecordingLogger(), { maxRecordingMs }) };
}

describe('WindowAudioCapture', () => {
  it('signals the recording limit once and keeps the captured audio', async () => {
    const { host, capture: audio } = capture(250);
    let signals = 0;
    audio.onLimitReached(() => {
      signals += 1;
    });
    await audio.start(SYSTEM_DEFAULT);

    host.emitFrame(3200);
    host.emitFrame(3200);
    const beforeLimit = signals;
    host.emitFrame(3200);
    host.emitFrame(3200);

    expect(beforeLimit).toBe(0);
    expect(signals).toBe(1);
    expect(await audio.stop()).toHaveLength(8000);
  });

  it('accepts frames again in the next recording after the limit', async () => {
    const { host, capture: audio } = capture(100);
    await audio.start(SYSTEM_DEFAULT);
    host.emitFrame(6400);
    await audio.stop();

    await audio.start(SYSTEM_DEFAULT);
    host.emitFrame(1600);

    expect(await audio.stop()).toHaveLength(1600);
  });

  it('streams each kept recording frame to frame listeners, never meter frames or audio past the limit', async () => {
    const { host, capture: audio } = capture(250);
    const frames: number[] = [];
    audio.onFrame((pcm) => frames.push(pcm.byteLength));

    await audio.startMeter(SYSTEM_DEFAULT);
    host.emitFrame(3200);
    await audio.stopMeter();
    await audio.start(SYSTEM_DEFAULT);
    host.emitFrame(3200);
    host.emitFrame(3200);
    host.emitFrame(3200);
    host.emitFrame(3200);
    await audio.stop();
    host.emitFrame(3200);

    expect(frames).toEqual([3200, 3200, 1600]);
  });

  it('defaults to a 10 minute recording limit', async () => {
    const host = new FakeCaptureHost();
    const audio = new WindowAudioCapture(host, new RecordingLogger());
    let signals = 0;
    audio.onLimitReached(() => {
      signals += 1;
    });
    await audio.start(SYSTEM_DEFAULT);

    for (let frame = 0; frame < 5999; frame += 1) {
      host.emitFrame(3200);
    }
    const beforeLimit = signals;
    host.emitFrame(3200);

    expect(beforeLimit).toBe(0);
    expect(signals).toBe(1);
    expect(await audio.stop()).toHaveLength(600 * 32_000);
  });

  it('reports a fallback when the chosen device vanished before it was opened', async () => {
    const { host, capture: audio } = capture(1000);
    host.startResult = { label: 'MacBook Pro Microphone', fallback: true };

    const started = await audio.start({ deviceId: 'built-in-id', label: 'MacBook Pro Microphone' });

    expect(started).toEqual({ fallback: true, deviceLabel: 'MacBook Pro Microphone' });
    expect(host.requests).toContainEqual({ type: 'start', deviceId: 'built-in-id', mode: 'record' });
  });

  it('reports the end of a recording both after a stop and after a failed start', async () => {
    const host = new (class extends FakeCaptureHost {
      failStart = false;

      override request(request: CaptureRequest): Promise<unknown> {
        if (request.type === 'start' && this.failStart) {
          return Promise.reject(new Error('NotAllowedError'));
        }
        return super.request(request);
      }
    })();
    const audio = new WindowAudioCapture(host, new RecordingLogger());
    let ended = 0;
    audio.onRecordingStopped(() => {
      ended += 1;
    });

    await audio.start(SYSTEM_DEFAULT);
    await audio.stop();
    expect(ended).toBe(1);

    host.failStart = true;
    await expect(audio.start(SYSTEM_DEFAULT)).rejects.toThrow('NotAllowedError');
    expect(ended).toBe(2);

    await audio.stop();
    expect(ended).toBe(2);
  });

  it('refuses new recordings and meters while blocked for an update and accepts them again after unblocking', async () => {
    const { capture: audio } = capture(1000);

    const unblock = audio.block();
    await expect(audio.start(SYSTEM_DEFAULT)).rejects.toThrow('The microphone is closed for an app update');
    await expect(audio.startMeter(SYSTEM_DEFAULT)).rejects.toThrow('The microphone is closed for an app update');
    unblock();

    await expect(audio.start(SYSTEM_DEFAULT)).resolves.toEqual({ fallback: false, deviceLabel: 'MacBook Pro Microphone' });
  });
});
