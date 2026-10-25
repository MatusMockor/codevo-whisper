import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateKeyPair } from '@codevo-whisper/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileDeviceRepository } from '../src/devices/file-device-repository';
import { createTempDir } from './support/temp-dir';

let dir: Awaited<ReturnType<typeof createTempDir>>;

beforeEach(async () => {
  dir = await createTempDir();
});

afterEach(async () => {
  await dir.remove();
});

describe('FileDeviceRepository', () => {
  it('adds and finds a device by public key', async () => {
    const repository = new FileDeviceRepository(dir.path);
    const { publicKey } = generateKeyPair();
    const device = await repository.add('MacBook dev', publicKey);

    expect(device.id).toMatch(/^[0-9a-f]{8}$/);
    expect(device.name).toBe('MacBook dev');
    expect(device.lastSeenAt).toBeNull();
    expect(Date.parse(device.pairedAt)).not.toBeNaN();
    expect(await repository.findByPublicKey(publicKey)).toEqual(device);
    expect(await repository.findByPublicKey(generateKeyPair().publicKey)).toBeNull();
  });

  it('writes the registry with mode 0600', async () => {
    await new FileDeviceRepository(dir.path).add('MacBook dev', generateKeyPair().publicKey);
    const info = await stat(join(dir.path, 'devices.json'));

    expect(info.mode & 0o777).toBe(0o600);
  });

  it('same key twice returns the existing device', async () => {
    const repository = new FileDeviceRepository(dir.path);
    const { publicKey } = generateKeyPair();
    const first = await repository.add('MacBook', publicKey);
    const second = await repository.add('Iný názov', publicKey);

    expect(second).toEqual(first);
    expect(await repository.list()).toHaveLength(1);
  });

  it('remove returns false for unknown id', async () => {
    const repository = new FileDeviceRepository(dir.path);
    const device = await repository.add('MacBook', generateKeyPair().publicKey);

    expect(await repository.remove('deadbeef')).toBe(false);
    expect(await repository.remove(device.id)).toBe(true);
    expect(await repository.list()).toEqual([]);
  });

  it('removeAll clears the registry', async () => {
    const repository = new FileDeviceRepository(dir.path);
    await repository.add('A', generateKeyPair().publicKey);
    await repository.add('B', generateKeyPair().publicKey);
    await repository.removeAll();

    expect(await new FileDeviceRepository(dir.path).list()).toEqual([]);
  });

  it('touch records the last seen time', async () => {
    const repository = new FileDeviceRepository(dir.path);
    const device = await repository.add('A', generateKeyPair().publicKey);
    await repository.touch(device.id, new Date('2026-10-25T10:00:00.000Z'));

    expect((await repository.list())[0]?.lastSeenAt).toBe('2026-10-25T10:00:00.000Z');
  });

  it('persists across instances', async () => {
    const { publicKey } = generateKeyPair();
    const device = await new FileDeviceRepository(dir.path).add('MacBook', publicKey);

    expect(await new FileDeviceRepository(dir.path).findByPublicKey(publicKey)).toEqual(device);
  });

  it('keeps concurrent additions', async () => {
    const repository = new FileDeviceRepository(dir.path);
    await Promise.all(Array.from({ length: 10 }, (_, index) => repository.add(`D${index}`, generateKeyPair().publicKey)));

    expect(await new FileDeviceRepository(dir.path).list()).toHaveLength(10);
  });

  it('survives a crash between temp write and rename', async () => {
    const { publicKey } = generateKeyPair();
    const device = await new FileDeviceRepository(dir.path).add('MacBook', publicKey);
    const committed = await readFile(join(dir.path, 'devices.json'), 'utf8');
    await writeFile(join(dir.path, 'devices.json.12345.tmp'), '{"version":1,"devices":[', { mode: 0o600 });

    const reloaded = new FileDeviceRepository(dir.path);
    expect(await reloaded.list()).toEqual([device]);
    await reloaded.add('Druhý', generateKeyPair().publicKey);
    expect(await readFile(join(dir.path, 'devices.json'), 'utf8')).not.toBe(committed);
    expect(await new FileDeviceRepository(dir.path).list()).toHaveLength(2);
  });
});
