import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureRequests } from '../src/main/audio/capture-requests';

afterEach(() => {
  vi.useRealTimers();
});

describe('CaptureRequests', () => {
  it('resolves the pending request with the matching id', async () => {
    const requests = new CaptureRequests();
    const first = requests.create(1000);
    const second = requests.create(1000);

    expect(requests.settle({ id: second.id, ok: true, value: 'second' })).toBe(true);
    expect(requests.settle({ id: first.id, ok: true, value: 'first' })).toBe(true);

    await expect(first.promise).resolves.toBe('first');
    await expect(second.promise).resolves.toBe('second');
  });

  it('rejects with the reported error', async () => {
    const requests = new CaptureRequests();
    const pending = requests.create(1000);

    requests.settle({ id: pending.id, ok: false, error: 'NotAllowedError: Permission denied' });

    await expect(pending.promise).rejects.toThrow('NotAllowedError: Permission denied');
  });

  it('ignores replies for unknown or already settled ids', async () => {
    const requests = new CaptureRequests();
    const pending = requests.create(1000);
    requests.settle({ id: pending.id, ok: true, value: 1 });

    expect(requests.settle({ id: pending.id, ok: true, value: 2 })).toBe(false);
    expect(requests.settle({ id: 999, ok: true, value: 3 })).toBe(false);
    await expect(pending.promise).resolves.toBe(1);
  });

  it('times out a request without a reply', async () => {
    vi.useFakeTimers();
    const requests = new CaptureRequests();
    const pending = requests.create(500);
    const outcome = pending.promise.catch((error: unknown) => error);

    vi.advanceTimersByTime(500);

    expect(String(await outcome)).toContain('timed out');
    expect(requests.settle({ id: pending.id, ok: true, value: 1 })).toBe(false);
  });

  it('rejects every pending request at once', async () => {
    const requests = new CaptureRequests();
    const first = requests.create(1000);
    const second = requests.create(1000);

    requests.rejectAll(new Error('Capture window is gone'));

    await expect(first.promise).rejects.toThrow('Capture window is gone');
    await expect(second.promise).rejects.toThrow('Capture window is gone');
  });
});
