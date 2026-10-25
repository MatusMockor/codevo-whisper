import type { Settings } from '../../shared/settings';
import { isPlainRecord, isSettingsKey, isValidField } from '../settings/settings-fields';

export class IpcValidationError extends Error {
  override readonly name = 'IpcValidationError';
}

export function validateSettingsPatch(input: unknown): Partial<Settings> {
  if (!isPlainRecord(input)) {
    throw new IpcValidationError('Settings patch must be a plain object');
  }
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isSettingsKey(key)) {
      throw new IpcValidationError(`Unknown settings key: ${key.slice(0, 64)}`);
    }
    if (!isValidField(key, value)) {
      throw new IpcValidationError(`Invalid value for settings key: ${key}`);
    }
    patch[key] = value;
  }
  return patch;
}
