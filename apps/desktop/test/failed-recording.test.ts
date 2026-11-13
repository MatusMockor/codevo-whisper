import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FailedRecording } from '../src/main/session/failed-recording';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FailedRecording', () => {
  it('holds one recording for ten minutes from the first failure', () => {
    const held = new FailedRecording();
    const changes = vi.fn();
    held.onChange(changes);
    const first = new Uint8Array(4);
    const second = new Uint8Array(6);

    held.keep(first);
    vi.advanceTimersByTime(5 * 60_000);
    held.keep(first);
    expect(held.get()).toBe(first);
    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(held.get()).toBe(first);
    vi.advanceTimersByTime(1);
    expect(held.get()).toBeNull();

    const third = new Uint8Array(2);
    held.keep(third);
    held.keep(second);
    expect(held.get()).toBe(second);
    expect(held.keep(third)).toBe(false);
    vi.advanceTimersByTime(10 * 60_000);
    expect(held.get()).toBeNull();
    expect(changes).toHaveBeenCalledTimes(6);
  });

  it('forgets only the recording it holds', () => {
    const held = new FailedRecording();
    const kept = new Uint8Array(4);
    held.keep(kept);

    held.forget(new Uint8Array(4));
    expect(held.get()).toBe(kept);
    held.forget(kept);
    expect(held.get()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never holds a recording again once it was released', () => {
    const held = new FailedRecording();
    const expired = new Uint8Array(4);
    const forgotten = new Uint8Array(4);

    expect(held.keep(expired)).toBe(true);
    vi.advanceTimersByTime(10 * 60_000);
    expect(held.keep(expired)).toBe(false);
    expect(held.get()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    held.keep(forgotten);
    held.forget(forgotten);
    expect(held.keep(forgotten)).toBe(false);
    expect(held.get()).toBeNull();
  });

  it('drops the recording and its timer', () => {
    const held = new FailedRecording();
    const changes = vi.fn();
    held.onChange(changes);
    held.drop();
    expect(changes).not.toHaveBeenCalled();

    held.keep(new Uint8Array(2));
    held.drop();
    expect(held.get()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(changes).toHaveBeenCalledTimes(2);
  });
});
