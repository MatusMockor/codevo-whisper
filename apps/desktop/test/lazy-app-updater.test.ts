import { describe, expect, it } from 'vitest';
import { FakeAppUpdater } from '../src/main/updates/fake-app-updater';
import { LazyAppUpdater } from '../src/main/updates/lazy-app-updater';

describe('LazyAppUpdater', () => {
  it('loads the updater on first use only and reuses it', async () => {
    const fake = new FakeAppUpdater();
    fake.latest = '1.2.0';
    let loads = 0;
    const lazy = new LazyAppUpdater(() => {
      loads += 1;
      return Promise.resolve(fake);
    });
    expect(loads).toBe(0);

    expect(await lazy.check()).toEqual({ version: '1.2.0' });
    await lazy.download(() => undefined);
    void lazy.install();

    await expect.poll(() => fake.installs).toBe(1);
    expect(loads).toBe(1);
    expect(fake.downloads).toBe(1);
  });

  it('fails the call when loading fails and loads again next time', async () => {
    const fake = new FakeAppUpdater();
    let loads = 0;
    const lazy = new LazyAppUpdater(() => {
      loads += 1;
      return loads === 1 ? Promise.reject(new Error('Cannot find module electron-updater')) : Promise.resolve(fake);
    });

    await expect(lazy.check()).rejects.toThrow('Cannot find module electron-updater');
    expect(await lazy.check()).toBeNull();
    expect(loads).toBe(2);
  });
});
