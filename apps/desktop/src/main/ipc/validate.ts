import { PERMISSION_KINDS, type PermissionKind } from '../../shared/permissions';
import type { MicrophoneSetting, Settings } from '../../shared/settings';
import { isPlainRecord, isSettingsKey, isValidField, SETTINGS_FIELDS } from '../settings/settings-fields';

export class IpcValidationError extends Error {
  override readonly name = 'IpcValidationError';
}

const MAIN_OWNED_KEYS: ReadonlySet<keyof Settings> = new Set(['localModelId']);

const PHASE_ONE_UNAVAILABLE: ReadonlyArray<{ key: keyof Settings; value: unknown }> = [{ key: 'overlay', value: 'live' }];

function isUnavailable(key: keyof Settings, value: unknown): boolean {
  return PHASE_ONE_UNAVAILABLE.some((option) => option.key === key && option.value === value);
}

const MODEL_ID = /^[a-z0-9][a-z0-9.-]{0,127}$/;

export function validateSettingsPatch(input: unknown): Partial<Settings> {
  if (!isPlainRecord(input)) {
    throw new IpcValidationError('Settings patch must be a plain object');
  }
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isSettingsKey(key)) {
      throw new IpcValidationError(`Unknown settings key: ${key.slice(0, 64)}`);
    }
    if (MAIN_OWNED_KEYS.has(key)) {
      throw new IpcValidationError(`Settings key ${key} cannot be set directly`);
    }
    if (!isValidField(key, value) || isUnavailable(key, value)) {
      throw new IpcValidationError(`Invalid value for settings key: ${key}`);
    }
    patch[key] = value;
  }
  return patch;
}

export function validateModelId(input: unknown): string {
  if (typeof input !== 'string' || !MODEL_ID.test(input)) {
    throw new IpcValidationError('Invalid model id');
  }
  return input;
}

export function validatePermissionKind(input: unknown): PermissionKind {
  const kind = PERMISSION_KINDS.find((candidate) => candidate === input);
  if (kind === undefined) {
    throw new IpcValidationError('Invalid permission kind');
  }
  return kind;
}

export function validateMicrophone(input: unknown): MicrophoneSetting {
  if (!SETTINGS_FIELDS.microphone(input)) {
    throw new IpcValidationError('Invalid microphone');
  }
  return input;
}
