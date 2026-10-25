import { describe, expect, it } from 'vitest';
import { WindowAudioCapture } from '../src/main/audio/window-audio-capture';
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
});
