import { describe, expect, it } from 'vitest';
import { MicrophoneMeter } from '../src/main/audio/microphone-meter';
import { InProcessCapture, stampedPcm } from './in-process-capture';

const AIRPODS = { deviceId: 'airpods', label: 'AirPods Pro' };

function harness() {
  const capture = new InProcessCapture();
  const sent: number[] = [];
  const meter = new MicrophoneMeter(capture, (rms) => sent.push(rms));
  return { capture, sent, meter };
}

describe('MicrophoneMeter', () => {
  it('opens the chosen microphone in meter mode and forwards its levels', async () => {
    const { capture, sent, meter } = harness();

    await meter.start(AIRPODS);
    capture.speak(stampedPcm(1, 0.1), 0.4);
    capture.speak(stampedPcm(1, 0.1), 0.6);

    expect(capture.metering).toEqual(AIRPODS);
    expect(sent).toEqual([0.4, 0.6]);
  });

  it('stops forwarding and releases the microphone on stop', async () => {
    const { capture, sent, meter } = harness();
    await meter.start(AIRPODS);

    await meter.stop();
    capture.speak(stampedPcm(1, 0.1), 0.4);

    expect(capture.metering).toBeNull();
    expect(sent).toEqual([]);
  });

  it('switches to another microphone without duplicating levels', async () => {
    const { capture, sent, meter } = harness();

    await meter.start(AIRPODS);
    await meter.start({ deviceId: null, label: null });
    capture.speak(stampedPcm(1, 0.1), 0.3);

    expect(capture.metering).toEqual({ deviceId: null, label: null });
    expect(sent).toEqual([0.3]);
  });

  it('stops listening when opening the meter fails', async () => {
    const { capture, sent, meter } = harness();
    capture.startMeter = () => Promise.reject(new Error('NotAllowedError'));

    await expect(meter.start(AIRPODS)).rejects.toThrow('NotAllowedError');
    capture.metering = AIRPODS;
    capture.speak(stampedPcm(1, 0.1), 0.3);

    expect(sent).toEqual([]);
  });
});
