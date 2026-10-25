import { describe, expect, it } from 'vitest';
import { isBluetoothLabel, resolveDevice, toAudioDevices, type AudioDevice } from '../src/main/audio/device-resolver';

const builtIn: AudioDevice = { deviceId: 'built-in-id', label: 'MacBook Pro Microphone', isBluetooth: false, isDefault: false };
const airPods: AudioDevice = { deviceId: 'airpods-id', label: 'Matúš AirPods Pro', isBluetooth: true, isDefault: false };
const usb: AudioDevice = { deviceId: 'usb-id', label: 'Scarlett 2i2 USB', isBluetooth: false, isDefault: false };

describe('resolveDevice', () => {
  it('uses the system default when nothing was chosen', () => {
    expect(resolveDevice([builtIn, usb], { deviceId: null, label: null })).toEqual({ device: null, fallback: false });
  });

  it('matches by deviceId', () => {
    expect(resolveDevice([builtIn, usb], { deviceId: 'usb-id', label: 'Scarlett 2i2 USB' })).toEqual({ device: usb, fallback: false });
  });

  it('matches by label when the deviceId changed', () => {
    const reconnected = { ...airPods, deviceId: 'airpods-new-id' };

    expect(resolveDevice([builtIn, reconnected], { deviceId: 'airpods-id', label: 'Matúš AirPods Pro' })).toEqual({
      device: reconnected,
      fallback: false,
    });
  });

  it('falls back to the default device when the chosen one is missing', () => {
    expect(resolveDevice([builtIn, usb], { deviceId: 'airpods-id', label: 'Matúš AirPods Pro' })).toEqual({ device: null, fallback: true });
  });

  it('does not match an empty label', () => {
    const unlabeled = { ...usb, label: '' };

    expect(resolveDevice([unlabeled], { deviceId: 'gone-id', label: '' })).toEqual({ device: null, fallback: true });
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
