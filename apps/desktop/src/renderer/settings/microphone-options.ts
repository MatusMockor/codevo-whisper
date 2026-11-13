import { MAX_MICROPHONES, resolveDevice, type AudioDevice } from '../../shared/microphones';
import type { MicrophoneSetting } from '../../shared/settings';

export type MicrophoneRowState = 'active' | 'connected' | 'missing';

export type MicrophoneRow = { label: string; state: MicrophoneRowState; microphone: MicrophoneSetting };

export type MicrophoneView = { rows: MicrophoneRow[]; addable: MicrophoneSetting[]; usingDefault: boolean };

const BLUETOOTH_HINT =
  'Bluetooth slúchadlá sa pri zapnutom mikrofóne prepnú na hovorový profil, takže sa zhorší aj zvuk hudby. Ak počúvate cez AirPods, odporúčame vstavaný mikrofón Macu.';

function connectedAs(devices: readonly AudioDevice[], entry: MicrophoneSetting): AudioDevice | null {
  return resolveDevice(devices, [entry]).device;
}

export function microphoneView(devices: readonly AudioDevice[], list: readonly MicrophoneSetting[]): MicrophoneView {
  const recording = resolveDevice(devices, list).device;
  const rows = list.map((microphone): MicrophoneRow => {
    const device = connectedAs(devices, microphone);
    if (device === null) {
      return { label: microphone.label ?? 'Vybraný mikrofón', state: 'missing', microphone };
    }
    return { label: device.label, state: device === recording ? 'active' : 'connected', microphone };
  });
  const listed = new Set(list.map((entry) => connectedAs(devices, entry)));
  const addable = devices.filter((device) => !listed.has(device)).map((device) => ({ deviceId: device.deviceId, label: device.label }));
  return { rows, addable: list.length < MAX_MICROPHONES ? addable : [], usingDefault: recording === null };
}

export function moveMicrophone(list: readonly MicrophoneSetting[], index: number, offset: -1 | 1): MicrophoneSetting[] {
  const target = index + offset;
  const next = [...list];
  const [moved] = next.splice(index, 1);
  if (moved === undefined || target < 0 || target >= list.length) {
    return [...list];
  }
  next.splice(target, 0, moved);
  return next;
}

export function removeMicrophone(list: readonly MicrophoneSetting[], index: number): MicrophoneSetting[] {
  return list.filter((_, at) => at !== index);
}

export function addMicrophone(list: readonly MicrophoneSetting[], microphone: MicrophoneSetting): MicrophoneSetting[] {
  return [...list, microphone];
}

function recordingDevice(devices: readonly AudioDevice[], list: readonly MicrophoneSetting[]): AudioDevice | undefined {
  return resolveDevice(devices, list).device ?? devices.find((device) => device.isDefault);
}

export function bluetoothHint(devices: readonly AudioDevice[], list: readonly MicrophoneSetting[]): string | null {
  return recordingDevice(devices, list)?.isBluetooth === true ? BLUETOOTH_HINT : null;
}
