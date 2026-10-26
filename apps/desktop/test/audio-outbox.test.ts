import { describe, expect, it } from 'vitest';
import { AudioOutbox } from '../src/main/remote/audio-outbox';

const sizes = (frames: Uint8Array[]): number[] => frames.map((frame) => frame.byteLength);

describe('AudioOutbox', () => {
  it('sends capture frames as they are', () => {
    const outbox = new AudioOutbox();
    outbox.append(new Uint8Array(3200));

    expect(sizes(outbox.take(false))).toEqual([3200]);
    expect(outbox.take(false)).toEqual([]);
  });

  it('holds audio shorter than 20 ms until more arrives or the dictation ends', () => {
    const outbox = new AudioOutbox();
    outbox.append(new Uint8Array(400));
    expect(outbox.take(false)).toEqual([]);

    outbox.append(new Uint8Array(400));
    expect(sizes(outbox.take(false))).toEqual([800]);

    outbox.append(new Uint8Array(100));
    expect(sizes(outbox.take(true))).toEqual([100]);
  });

  it('coalesces a backlog into frames of at most 32000 bytes and keeps a short tail back', () => {
    const outbox = new AudioOutbox();
    for (let index = 0; index < 21; index += 1) {
      outbox.append(new Uint8Array(3200));
    }
    outbox.append(new Uint8Array(200));

    expect(sizes(outbox.take(false))).toEqual([32000, 32000, 3400]);

    for (let index = 0; index < 20; index += 1) {
      outbox.append(new Uint8Array(3200));
    }
    outbox.append(new Uint8Array(200));

    expect(sizes(outbox.take(false))).toEqual([32000, 32000]);
    expect(sizes(outbox.take(true))).toEqual([200]);
  });

  it('keeps the bytes in order', () => {
    const outbox = new AudioOutbox();
    outbox.append(Uint8Array.from([1, 2]));
    outbox.append(Uint8Array.from([3, 4]));

    expect(outbox.take(true)).toEqual([Uint8Array.from([1, 2, 3, 4])]);
  });

  it('drops an odd trailing byte at the end', () => {
    const outbox = new AudioOutbox();
    outbox.append(new Uint8Array(1281));

    expect(sizes(outbox.take(true))).toEqual([1280]);
  });

  it('can be refilled for a retry', () => {
    const outbox = new AudioOutbox();
    outbox.append(new Uint8Array(3200));
    outbox.take(false);

    outbox.reset(new Uint8Array(64000));

    expect(sizes(outbox.take(false))).toEqual([32000, 32000]);
  });
});
