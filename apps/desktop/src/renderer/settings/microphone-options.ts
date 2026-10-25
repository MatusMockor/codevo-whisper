import type { AudioDevice } from '../../shared/microphones';
import type { MicrophoneSetting } from '../../shared/settings';

export const SYSTEM_DEFAULT_VALUE = 'system-default';

export type MicrophoneOption = { value: string; label: string; microphone: MicrophoneSetting };

export type MicrophoneOptions = { selected: string; options: MicrophoneOption[] };

const SYSTEM_DEFAULT: MicrophoneOption = { value: SYSTEM_DEFAULT_VALUE, label: 'Systémový predvolený', microphone: { deviceId: null, label: null } };

const BLUETOOTH_HINT =
  'Bluetooth slúchadlá sa pri zapnutom mikrofóne prepnú na hovorový profil, takže sa zhorší aj zvuk hudby. Ak počúvate cez AirPods, odporúčame vstavaný mikrofón Macu.';

function isSystemDefault(chosen: MicrophoneSetting): boolean {
  return chosen.deviceId === null && chosen.label === null;
}

function missingOption(devices: readonly AudioDevice[], chosen: MicrophoneSetting): MicrophoneOption[] {
  if (isSystemDefault(chosen) || devices.some((device) => device.deviceId === chosen.deviceId)) {
    return [];
  }
  const label = chosen.label ?? 'Vybraný mikrofón';
  return [{ value: chosen.deviceId ?? label, label: `${label} (nepripojený)`, microphone: chosen }];
}

export function microphoneOptions(devices: readonly AudioDevice[], chosen: MicrophoneSetting): MicrophoneOptions {
  const connected = devices.map((device) => ({ value: device.deviceId, label: device.label, microphone: { deviceId: device.deviceId, label: device.label } }));
  const options = [SYSTEM_DEFAULT, ...connected, ...missingOption(devices, chosen)];
  if (isSystemDefault(chosen)) {
    return { selected: SYSTEM_DEFAULT_VALUE, options };
  }
  return { selected: chosen.deviceId ?? chosen.label ?? SYSTEM_DEFAULT_VALUE, options };
}

export function bluetoothHint(devices: readonly AudioDevice[], chosen: MicrophoneSetting): string | null {
  const device = devices.find((candidate) => candidate.deviceId === chosen.deviceId);
  return device?.isBluetooth === true ? BLUETOOTH_HINT : null;
}
