import type { MicrophoneSetting } from './settings';

export type AudioDevice = { deviceId: string; label: string; isBluetooth: boolean; isDefault: boolean };

export type ResolvedDevice = { device: AudioDevice | null; fallback: boolean };

export const MAX_MICROPHONES = 16;

function hasLabel(label: string | null): label is string {
  return label !== null && label !== '';
}

function findDevice(devices: readonly AudioDevice[], chosen: MicrophoneSetting): AudioDevice | undefined {
  const byId = devices.find((device) => device.deviceId === chosen.deviceId);
  if (byId !== undefined || !hasLabel(chosen.label)) {
    return byId;
  }
  return devices.find((device) => device.label === chosen.label);
}

export function resolveDevice(devices: readonly AudioDevice[], list: readonly MicrophoneSetting[]): ResolvedDevice {
  for (const chosen of list) {
    const device = findDevice(devices, chosen);
    if (device !== undefined) {
      return { device, fallback: false };
    }
  }
  return { device: null, fallback: list.length > 0 };
}

function sameMicrophone(a: MicrophoneSetting, b: MicrophoneSetting): boolean {
  if (a.deviceId !== null && b.deviceId !== null) {
    return a.deviceId === b.deviceId;
  }
  return hasLabel(a.label) && a.label === b.label;
}

export function promoteMicrophone(list: readonly MicrophoneSetting[], chosen: MicrophoneSetting): MicrophoneSetting[] {
  return [chosen, ...list.filter((entry) => !sameMicrophone(entry, chosen))].slice(0, MAX_MICROPHONES);
}
