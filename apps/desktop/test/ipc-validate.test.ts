import { describe, expect, it } from 'vitest';
import { IpcValidationError, validateMicrophone, validateModelId, validatePermissionKind, validateSettingsPatch } from '../src/main/ipc/validate';

describe('validateSettingsPatch', () => {
  it('returns a valid patch', () => {
    const patch = validateSettingsPatch({
      hotkey: { keycode: 61, label: 'Pravý ⌥ Option' },
      microphone: { deviceId: null, label: null },
      engineOrder: ['local'],
      launchAtLogin: true,
    });

    expect(patch).toEqual({
      hotkey: { keycode: 61, label: 'Pravý ⌥ Option' },
      microphone: { deviceId: null, label: null },
      engineOrder: ['local'],
      launchAtLogin: true,
    });
  });

  it('accepts clearing the hotkey', () => {
    expect(validateSettingsPatch({ hotkey: null })).toEqual({ hotkey: null });
  });

  it('rejects unknown keys', () => {
    expect(() => validateSettingsPatch({ mode: 'hold', history: [] })).toThrow(IpcValidationError);
    expect(() => validateSettingsPatch(JSON.parse('{"__proto__": {"mode": "toggle"}}'))).toThrow(IpcValidationError);
  });

  it('rejects a payload that is not a plain object', () => {
    for (const input of [null, undefined, 'mode', 7, ['hold']]) {
      expect(() => validateSettingsPatch(input)).toThrow(IpcValidationError);
    }
  });

  it('rejects a keycode outside the allowed set', () => {
    expect(() => validateSettingsPatch({ hotkey: { keycode: 12, label: 'Q' } })).toThrow(IpcValidationError);
    expect(() => validateSettingsPatch({ hotkey: { keycode: '62', label: 'Pravý ⌃ Control' } })).toThrow(IpcValidationError);
  });

  it('rejects a hotkey with extra properties', () => {
    expect(() => validateSettingsPatch({ hotkey: { keycode: 62, label: 'Pravý ⌃ Control', modifiers: 1 } })).toThrow(IpcValidationError);
  });

  it('accepts the four engine orders', () => {
    for (const engineOrder of [['local'], ['server'], ['server', 'local'], ['local', 'server']]) {
      expect(validateSettingsPatch({ engineOrder })).toEqual({ engineOrder });
    }
  });

  it('rejects any other engine order', () => {
    for (const engineOrder of [[], ['server', 'server'], ['local', 'local'], ['cloud'], ['local', 'server', 'local'], 'server', [null]]) {
      expect(() => validateSettingsPatch({ engineOrder })).toThrow(IpcValidationError);
    }
  });

  it('rejects values outside the allowed enums', () => {
    expect(() => validateSettingsPatch({ mode: 'press' })).toThrow(IpcValidationError);
    expect(() => validateSettingsPatch({ language: 'de' })).toThrow(IpcValidationError);
    expect(() => validateSettingsPatch({ insertion: 'type' })).toThrow(IpcValidationError);
    expect(() => validateSettingsPatch({ overlay: 'fullscreen' })).toThrow(IpcValidationError);
    expect(() => validateSettingsPatch({ launchAtLogin: 'true' })).toThrow(IpcValidationError);
  });
});

describe('validateSettingsPatch and the active model', () => {
  it('rejects setting the active model directly, it goes through activateModel', () => {
    expect(() => validateSettingsPatch({ localModelId: 'parakeet-ultra-q8' })).toThrow(IpcValidationError);
    expect(() => validateSettingsPatch({ localModelId: null })).toThrow(IpcValidationError);
  });
});

describe('validateModelId', () => {
  it('accepts a catalog style id', () => {
    expect(validateModelId('parakeet-ultra-q8')).toBe('parakeet-ultra-q8');
    expect(validateModelId('tc-whisper-turbo-q8')).toBe('tc-whisper-turbo-q8');
  });

  it.each([[''], ['../models'], ['A'.repeat(200)], [42], [null], [{ id: 'x' }]])('rejects %j', (input) => {
    expect(() => validateModelId(input)).toThrow(IpcValidationError);
  });
});

describe('validatePermissionKind', () => {
  it('accepts the three permissions', () => {
    expect(['microphone', 'input-monitoring', 'accessibility'].map((kind) => validatePermissionKind(kind))).toEqual(['microphone', 'input-monitoring', 'accessibility']);
  });

  it('rejects anything else', () => {
    expect(() => validatePermissionKind('camera')).toThrow(IpcValidationError);
    expect(() => validatePermissionKind(undefined)).toThrow(IpcValidationError);
  });
});

describe('validateMicrophone', () => {
  it('accepts the system default and a chosen device', () => {
    expect(validateMicrophone({ deviceId: null, label: null })).toEqual({ deviceId: null, label: null });
    expect(validateMicrophone({ deviceId: 'abc', label: 'AirPods Pro' })).toEqual({ deviceId: 'abc', label: 'AirPods Pro' });
  });

  it('rejects malformed microphones', () => {
    expect(() => validateMicrophone({ deviceId: 'abc' })).toThrow(IpcValidationError);
    expect(() => validateMicrophone({ deviceId: 1, label: null })).toThrow(IpcValidationError);
    expect(() => validateMicrophone('default')).toThrow(IpcValidationError);
  });
});

describe('validateSettingsPatch and the overlay mode', () => {
  it('rejects Živý text in this phase and accepts the indicator', () => {
    expect(() => validateSettingsPatch({ overlay: 'live' })).toThrow(IpcValidationError);
    expect(validateSettingsPatch({ overlay: 'indicator' })).toEqual({ overlay: 'indicator' });
  });
});
