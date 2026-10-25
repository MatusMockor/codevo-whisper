import type { RawAudioDevice } from '../../shared/capture-contract';
import type { AudioDevice } from '../../shared/microphones';
import type { MicrophoneSetting } from '../../shared/settings';

export type { AudioDevice };

export type ResolvedDevice = { device: AudioDevice | null; fallback: boolean };

const ALIAS_DEVICE_IDS: ReadonlySet<string> = new Set(['default', 'communications']);

const BLUETOOTH_LABEL = /airpods|bluetooth|headset|buds/i;

export function isBluetoothLabel(label: string): boolean {
  return BLUETOOTH_LABEL.test(label);
}

const DEFAULT_ALIAS_ID = 'default';

function defaultDeviceId(raw: readonly RawAudioDevice[], inputs: readonly RawAudioDevice[]): string | null {
  const alias = raw.find((device) => device.deviceId === DEFAULT_ALIAS_ID)?.label;
  if (alias === undefined) {
    return null;
  }
  const matches = inputs.filter((device) => device.label !== '' && alias.endsWith(device.label));
  const longest = matches.sort((a, b) => b.label.length - a.label.length)[0];
  return longest?.deviceId ?? null;
}

export function toAudioDevices(raw: readonly RawAudioDevice[]): AudioDevice[] {
  const inputs = raw.filter((device) => device.deviceId !== '' && !ALIAS_DEVICE_IDS.has(device.deviceId));
  const defaultId = defaultDeviceId(raw, inputs);
  return inputs.map((device) => ({
    deviceId: device.deviceId,
    label: device.label,
    isBluetooth: isBluetoothLabel(device.label),
    isDefault: device.deviceId === defaultId,
  }));
}

function findDevice(devices: readonly AudioDevice[], chosen: MicrophoneSetting): AudioDevice | undefined {
  const byId = devices.find((device) => device.deviceId === chosen.deviceId);
  if (byId !== undefined) {
    return byId;
  }
  if (chosen.label === null || chosen.label === '') {
    return undefined;
  }
  return devices.find((device) => device.label === chosen.label);
}

export function resolveDevice(devices: AudioDevice[], chosen: MicrophoneSetting): ResolvedDevice {
  if (chosen.deviceId === null && chosen.label === null) {
    return { device: null, fallback: false };
  }
  const device = findDevice(devices, chosen);
  if (device === undefined) {
    return { device: null, fallback: true };
  }
  return { device, fallback: false };
}
