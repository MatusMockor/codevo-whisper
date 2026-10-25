import { fromBase64url, toBase64url } from '../encoding';
import type { Device } from './device-repository';

type StoredDevice = { id: string; name: string; publicKey: string; pairedAt: string; lastSeenAt: string | null };

type StoredRegistry = { version: 1; devices: StoredDevice[] };

const KEY_BYTES = 32;

function isStoredDevice(value: unknown): value is StoredDevice {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const device = value as Record<string, unknown>;
  return (
    typeof device.id === 'string' &&
    typeof device.name === 'string' &&
    typeof device.publicKey === 'string' &&
    typeof device.pairedAt === 'string' &&
    (device.lastSeenAt === null || typeof device.lastSeenAt === 'string')
  );
}

function isStoredRegistry(value: unknown): value is StoredRegistry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const registry = value as Record<string, unknown>;
  return registry.version === 1 && Array.isArray(registry.devices) && registry.devices.every(isStoredDevice);
}

export function decodeRegistry(text: string): Device[] {
  const parsed: unknown = JSON.parse(text);
  if (!isStoredRegistry(parsed)) {
    throw new Error('device registry has an unknown format');
  }
  return parsed.devices.map((device) => ({ ...device, publicKey: fromBase64url(device.publicKey, KEY_BYTES, 'device public key') }));
}

export function encodeRegistry(devices: Device[]): string {
  const registry: StoredRegistry = {
    version: 1,
    devices: devices.map((device) => ({ ...device, publicKey: toBase64url(device.publicKey) })),
  };
  return `${JSON.stringify(registry, null, 2)}\n`;
}
