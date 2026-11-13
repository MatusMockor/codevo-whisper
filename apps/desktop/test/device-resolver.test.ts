import { describe, expect, it } from 'vitest';
import { isBluetoothLabel, toAudioDevices } from '../src/main/audio/device-resolver';
import { promoteMicrophone, resolveDevice, type AudioDevice } from '../src/shared/microphones';

const builtIn: AudioDevice = { deviceId: 'built-in-id', label: 'MacBook Pro Microphone', isBluetooth: false, isDefault: false };
const airPods: AudioDevice = { deviceId: 'airpods-id', label: 'Matúš AirPods Pro', isBluetooth: true, isDefault: false };
const usb: AudioDevice = { deviceId: 'usb-id', label: 'Scarlett 2i2 USB', isBluetooth: false, isDefault: false };

describe('resolveDevice', () => {
  it('uses the system default when the list is empty', () => {
    expect(resolveDevice([builtIn, usb], [])).toEqual({ device: null, fallback: false });
  });

  it('matches by deviceId', () => {
    expect(resolveDevice([builtIn, usb], [{ deviceId: 'usb-id', label: 'Scarlett 2i2 USB' }])).toEqual({ device: usb, fallback: false });
  });

  it('matches by label when the deviceId changed', () => {
    const reconnected = { ...airPods, deviceId: 'airpods-new-id' };

    expect(resolveDevice([builtIn, reconnected], [{ deviceId: 'airpods-id', label: 'Matúš AirPods Pro' }])).toEqual({
      device: reconnected,
      fallback: false,
    });
  });

  it('uses the first connected entry in list order', () => {
    const list = [
      { deviceId: 'airpods-id', label: 'Matúš AirPods Pro' },
      { deviceId: 'usb-id', label: 'Scarlett 2i2 USB' },
      { deviceId: 'built-in-id', label: 'MacBook Pro Microphone' },
    ];

    expect(resolveDevice([builtIn, usb], list)).toEqual({ device: usb, fallback: false });
    expect(resolveDevice([builtIn, usb, airPods], list)).toEqual({ device: airPods, fallback: false });
  });

  it('prefers a higher entry matched by label over a lower entry matched by id', () => {
    const reconnected = { ...airPods, deviceId: 'airpods-new-id' };
    const list = [
      { deviceId: 'airpods-id', label: 'Matúš AirPods Pro' },
      { deviceId: 'usb-id', label: 'Scarlett 2i2 USB' },
    ];

    expect(resolveDevice([usb, reconnected], list)).toEqual({ device: reconnected, fallback: false });
  });

  it('falls back to the default device when no entry is connected', () => {
    expect(resolveDevice([builtIn, usb], [{ deviceId: 'airpods-id', label: 'Matúš AirPods Pro' }])).toEqual({ device: null, fallback: true });
  });

  it('does not match an empty label', () => {
    const unlabeled = { ...usb, label: '' };

    expect(resolveDevice([unlabeled], [{ deviceId: 'gone-id', label: '' }])).toEqual({ device: null, fallback: true });
  });
});

describe('promoteMicrophone', () => {
  const usbEntry = { deviceId: 'usb-id', label: 'Scarlett 2i2 USB' };
  const airPodsEntry = { deviceId: 'airpods-id', label: 'Matúš AirPods Pro' };
  const builtInEntry = { deviceId: 'built-in-id', label: 'MacBook Pro Microphone' };

  it('moves a listed device to the top and keeps the rest in order', () => {
    expect(promoteMicrophone([usbEntry, airPodsEntry, builtInEntry], builtInEntry)).toEqual([builtInEntry, usbEntry, airPodsEntry]);
  });

  it('adds a new device at the top', () => {
    expect(promoteMicrophone([usbEntry], airPodsEntry)).toEqual([airPodsEntry, usbEntry]);
  });

  it('keeps two devices of the same model that carry different ids', () => {
    const laptop = { deviceId: 'laptop', label: 'Laptop Mic' };
    const usbA = { deviceId: 'usb-a', label: 'USB Audio Device' };
    const usbB = { deviceId: 'usb-b', label: 'USB Audio Device' };

    expect(promoteMicrophone([laptop, usbA, usbB], usbB)).toEqual([usbB, laptop, usbA]);
  });

  it('dedupes an entry without an id by its label', () => {
    const idless = { deviceId: null, label: 'Matúš AirPods Pro' };

    expect(promoteMicrophone([usbEntry, idless], airPodsEntry)).toEqual([airPodsEntry, usbEntry]);
  });
});

describe('isBluetoothLabel', () => {
  it('flags AirPods as Bluetooth', () => {
    expect(isBluetoothLabel('Matúš AirPods Pro')).toBe(true);
  });

  it('flags other Bluetooth headsets by label', () => {
    for (const label of ['Bose QC Bluetooth', 'Jabra Headset', 'Galaxy Buds2', 'airpods max']) {
      expect(isBluetoothLabel(label)).toBe(true);
    }
  });

  it('does not flag wired or built-in inputs', () => {
    for (const label of ['MacBook Pro Microphone', 'Scarlett 2i2 USB', 'iPhone Microphone', '']) {
      expect(isBluetoothLabel(label)).toBe(false);
    }
  });
});

describe('toAudioDevices', () => {
  it('drops the default and communications aliases and flags Bluetooth inputs', () => {
    const devices = toAudioDevices([
      { deviceId: 'default', label: 'Predvolené - MacBook Pro Microphone' },
      { deviceId: 'communications', label: 'Komunikácia - MacBook Pro Microphone' },
      { deviceId: 'built-in-id', label: 'MacBook Pro Microphone' },
      { deviceId: 'airpods-id', label: 'Matúš AirPods Pro' },
      { deviceId: '', label: 'Unknown' },
    ]);

    expect(devices).toEqual([{ ...builtIn, isDefault: true }, airPods]);
  });

  it('marks the input behind the system default alias', () => {
    const devices = toAudioDevices([
      { deviceId: 'default', label: 'Default - Matúš AirPods Pro' },
      { deviceId: 'built-in-id', label: 'MacBook Pro Microphone' },
      { deviceId: 'airpods-id', label: 'Matúš AirPods Pro' },
    ]);

    expect(devices).toEqual([builtIn, { ...airPods, isDefault: true }]);
  });

  it('marks nothing when the alias is missing', () => {
    expect(toAudioDevices([{ deviceId: 'built-in-id', label: 'MacBook Pro Microphone' }])).toEqual([builtIn]);
  });
});
