import { join } from 'node:path';
import { equalBytes } from '../encoding';
import { ensurePrivateDir, readPrivateFile, writePrivateFileAtomic } from '../storage/private-file';
import { deviceIdOf } from './device-id';
import { decodeRegistry, encodeRegistry } from './device-file-format';
import type { Device, DeviceRepository } from './device-repository';

const FILE_NAME = 'devices.json';

function copy(device: Device): Device {
  return { ...device, publicKey: Uint8Array.from(device.publicKey) };
}

export class FileDeviceRepository implements DeviceRepository {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dataDir: string) {
    this.file = join(dataDir, FILE_NAME);
  }

  add(name: string, publicKey: Uint8Array): Promise<Device> {
    return this.mutate((devices) => {
      const existing = devices.find((device) => equalBytes(device.publicKey, publicKey));
      if (existing !== undefined) {
        return { devices, result: copy(existing) };
      }
      const id = deviceIdOf(publicKey);
      if (devices.some((device) => device.id === id)) {
        throw new Error(`device id ${id} is already used by another key`);
      }
      const device: Device = { id, name, publicKey: Uint8Array.from(publicKey), pairedAt: new Date().toISOString(), lastSeenAt: null };
      return { devices: [...devices, device], result: copy(device) };
    });
  }

  async findByPublicKey(publicKey: Uint8Array): Promise<Device | null> {
    const devices = await this.serialized(() => this.read());
    const device = devices.find((candidate) => equalBytes(candidate.publicKey, publicKey));
    return device === undefined ? null : copy(device);
  }

  async list(): Promise<Device[]> {
    const devices = await this.serialized(() => this.read());
    return devices.map(copy);
  }

  remove(id: string): Promise<boolean> {
    return this.mutate((devices) => {
      const remaining = devices.filter((device) => device.id !== id);
      return { devices: remaining, result: remaining.length !== devices.length };
    });
  }

  removeAll(): Promise<void> {
    return this.mutate(() => ({ devices: [], result: undefined }));
  }

  touch(id: string, at: Date): Promise<void> {
    return this.mutate((devices) => ({
      devices: devices.map((device) => (device.id === id ? { ...device, lastSeenAt: at.toISOString() } : device)),
      result: undefined,
    }));
  }

  private mutate<T>(change: (devices: Device[]) => { devices: Device[]; result: T }): Promise<T> {
    return this.serialized(async () => {
      const { devices, result } = change(await this.read());
      await ensurePrivateDir(this.dataDir);
      await writePrivateFileAtomic(this.file, encodeRegistry(devices));
      return result;
    });
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<Device[]> {
    const text = await readPrivateFile(this.file, { requirePrivateMode: false });
    if (text === null) {
      return [];
    }
    return decodeRegistry(text);
  }
}
