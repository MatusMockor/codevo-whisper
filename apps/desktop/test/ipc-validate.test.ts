import { describe, expect, it } from 'vitest';
import { IpcValidationError, rejectArguments, validateMicrophone, validateModelId, validatePairingToken, validatePermissionKind, validateSettingsPatch } from '../src/main/ipc/validate';

describe('validateSettingsPatch', () => {
  it.each(['hold', 'toggle', 'smart'])('accepts %s dictation mode at the IPC boundary', (mode) => {
    expect(validateSettingsPatch({ mode })).toEqual({ mode });
  });

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
  it('accepts the indicator and Živý text and rejects anything else', () => {
    expect(validateSettingsPatch({ overlay: 'live' })).toEqual({ overlay: 'live' });
    expect(validateSettingsPatch({ overlay: 'indicator' })).toEqual({ overlay: 'indicator' });
    expect(() => validateSettingsPatch({ overlay: 'text' })).toThrow(IpcValidationError);
    expect(() => validateSettingsPatch({ overlay: null })).toThrow(IpcValidationError);
  });
});

describe('validatePairingToken', () => {
  it('passes a trimmed token string through', () => {
    expect(validatePairingToken('  cw1:abc:def:ws%3A%2F%2Fhost  ')).toBe('cw1:abc:def:ws%3A%2F%2Fhost');
  });

  it('rejects non-strings, empty text and text longer than 1024 characters', () => {
    for (const input of [null, 42, {}, '', '   ', 'x'.repeat(1025)]) {
      expect(() => validatePairingToken(input)).toThrow(IpcValidationError);
    }
  });
});

describe('rejectArguments', () => {
  it('accepts a call without arguments', () => {
    expect(() => rejectArguments([])).not.toThrow();
  });

  it('rejects any argument, also undefined', () => {
    expect(() => rejectArguments(['x'])).toThrow(IpcValidationError);
    expect(() => rejectArguments([undefined])).toThrow(IpcValidationError);
  });
});

describe('resident settings IPC', () => {
  it('accepts the specified retention and acceleration values only', () => {
    for (const localModelUnload of ['never', 'immediately', 2, 5, 10, 15, 60]) {
      expect(validateSettingsPatch({ localModelUnload })).toEqual({ localModelUnload });
    }
    for (const localAcceleration of ['auto', 'gpu', 'cpu']) {
      expect(validateSettingsPatch({ localAcceleration })).toEqual({ localAcceleration });
    }
    for (const patch of [{ localModelUnload: 0 }, { localModelUnload: '5' }, { localModelUnload: 30 }, { localAcceleration: 'metal' }]) {
      expect(() => validateSettingsPatch(patch)).toThrow(IpcValidationError);
    }
  });
});
