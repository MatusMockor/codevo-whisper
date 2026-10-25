import { describe, expect, it } from 'vitest';
import { openWithFallback } from '../src/renderer/capture/open-with-fallback';

function rejection(name: string): Error {
  const error = new Error(`${name} raised`);
  error.name = name;
  return error;
}

function opener(failures: Record<string, Error>): { attempts: Array<string | null>; open: (deviceId: string | null) => Promise<string> } {
  const attempts: Array<string | null> = [];
  return {
    attempts,
    open: (deviceId) => {
      attempts.push(deviceId);
      const failure = failures[deviceId ?? 'system-default'];
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      return Promise.resolve(`stream:${deviceId ?? 'system-default'}`);
    },
  };
}

describe('openWithFallback', () => {
  it('opens the chosen device', async () => {
    const { attempts, open } = opener({});

    expect(await openWithFallback(open, 'usb-id')).toEqual({ value: 'stream:usb-id', fallback: false });
    expect(attempts).toEqual(['usb-id']);
  });

  it('retries once with the system default when the chosen device vanished', async () => {
    for (const name of ['OverconstrainedError', 'NotFoundError']) {
      const { attempts, open } = opener({ 'usb-id': rejection(name) });

      expect(await openWithFallback(open, 'usb-id')).toEqual({ value: 'stream:system-default', fallback: true });
      expect(attempts).toEqual(['usb-id', null]);
    }
  });

  it('does not retry other failures', async () => {
    const { attempts, open } = opener({ 'usb-id': rejection('NotAllowedError') });

    await expect(openWithFallback(open, 'usb-id')).rejects.toThrow('NotAllowedError raised');
    expect(attempts).toEqual(['usb-id']);
  });

  it('does not retry the system default itself', async () => {
    const { attempts, open } = opener({ 'system-default': rejection('NotFoundError') });

    await expect(openWithFallback(open, null)).rejects.toThrow('NotFoundError raised');
    expect(attempts).toEqual([null]);
  });
});
