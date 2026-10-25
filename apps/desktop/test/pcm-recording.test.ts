import { describe, expect, it } from 'vitest';
import { PcmRecording } from '../src/main/audio/pcm-recording';

describe('PcmRecording', () => {
  it('keeps frames until the limit and reports reaching it once', () => {
    const recording = new PcmRecording(8000);

    expect(recording.append(new Uint8Array(3200).fill(1))).toBe('kept');
    expect(recording.append(new Uint8Array(3200).fill(2))).toBe('kept');
    expect(recording.append(new Uint8Array(3200).fill(3))).toBe('limit-reached');
    expect(recording.append(new Uint8Array(3200).fill(4))).toBe('full');

    const pcm = recording.take();
    expect(pcm).toHaveLength(8000);
    expect(pcm[7999]).toBe(3);
  });

  it('reports the limit when a frame fills it exactly', () => {
    const recording = new PcmRecording(6400);

    recording.append(new Uint8Array(3200));

    expect(recording.append(new Uint8Array(3200))).toBe('limit-reached');
    expect(recording.take()).toHaveLength(6400);
  });

  it('starts empty again after take', () => {
    const recording = new PcmRecording(3200);
    recording.append(new Uint8Array(3200));
    recording.take();

    expect(recording.take()).toHaveLength(0);
    expect(recording.append(new Uint8Array(1600))).toBe('kept');
  });

  it('drops kept audio on clear', () => {
    const recording = new PcmRecording(3200);
    recording.append(new Uint8Array(3200));
    recording.clear();

    expect(recording.append(new Uint8Array(1600))).toBe('kept');
    expect(recording.take()).toHaveLength(1600);
  });
});
