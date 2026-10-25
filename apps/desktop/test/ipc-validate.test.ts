import { describe, expect, it } from 'vitest';
import { IpcValidationError, validateSettingsPatch } from '../src/main/ipc/validate';

describe('validateSettingsPatch', () => {
  it('returns a valid patch', () => {
    const patch = validateSettingsPatch({
      hotkey: { keycode: 61, label: 'Pravý ⌥ Option' },
      microphone: { deviceId: null, label: null },
      engineOrder: ['local'],
      localModelId: 'parakeet-ultra-f16',
      launchAtLogin: true,
    });

    expect(patch).toEqual({
      hotkey: { keycode: 61, label: 'Pravý ⌥ Option' },
      microphone: { deviceId: null, label: null },
      engineOrder: ['local'],
      localModelId: 'parakeet-ultra-f16',
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

  it('rejects engineOrder containing server in this phase', () => {
    for (const engineOrder of [['server'], ['local', 'server'], ['server', 'local'], [], ['local', 'local']]) {
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
