import { parseHotkeySetting, type HotkeyEvent } from '../../shared/hotkey';
import type { HotkeyRecordResult } from '../../shared/hotkey-record';
import { isReservedHotkey } from '../settings/hotkey-policy';
import type { HelperMessage } from './helper-channel';
import type { AppTarget, FocusedElement, InputLostReason, ModifierFlags, Permissions, ShortcutName } from './input-helper';

const SHIFT_MASK = 0x20000;
const CONTROL_MASK = 0x40000;
const OPTION_MASK = 0x80000;
const COMMAND_MASK = 0x100000;

function nullableBoolean(message: HelperMessage, key: string): boolean | null {
  const value = message[key];
  return typeof value === 'boolean' ? value : null;
}

function nullableString(message: HelperMessage, key: string): string | null {
  const value = message[key];
  return typeof value === 'string' ? value : null;
}

function nullableInteger(message: HelperMessage, key: string): number | null {
  const value = message[key];
  return Number.isInteger(value) ? (value as number) : null;
}

export function requireBoolean(message: HelperMessage, key: string, failure: string): boolean {
  const value = nullableBoolean(message, key);
  if (value === null) {
    throw new Error(failure);
  }
  return value;
}

export function isTrue(message: HelperMessage, key: string): boolean {
  return message[key] === true;
}

export function parsePermissions(message: HelperMessage): Permissions {
  return {
    listen: isTrue(message, 'listenEvent'),
    post: isTrue(message, 'postEvent'),
    accessibility: isTrue(message, 'accessibility'),
  };
}

export function parseFrontmost(message: HelperMessage): AppTarget | null {
  const pid = nullableInteger(message, 'pid');
  if (pid === null || pid <= 0) {
    return null;
  }
  return {
    bundleId: nullableString(message, 'bundleId') ?? '',
    pid,
    name: nullableString(message, 'name') ?? '',
    windowId: nullableInteger(message, 'windowId'),
  };
}

export function parseFocusedElement(message: HelperMessage): FocusedElement {
  return { editable: nullableBoolean(message, 'editable'), role: nullableString(message, 'role') };
}

export function parseModifierFlags(message: HelperMessage): ModifierFlags {
  const flags = nullableInteger(message, 'flags');
  if (flags === null || flags < 0) {
    throw new Error('modifier-flags-invalid');
  }
  return {
    control: (flags & CONTROL_MASK) !== 0,
    command: (flags & COMMAND_MASK) !== 0,
    option: (flags & OPTION_MASK) !== 0,
    shift: (flags & SHIFT_MASK) !== 0,
  };
}

export function parseHotkeyEvent(message: HelperMessage): HotkeyEvent | null {
  const phase = message['phase'];
  const ts = message['ts'];
  if (message['event'] !== 'hotkey' || (phase !== 'down' && phase !== 'up') || typeof ts !== 'number' || !Number.isSafeInteger(ts) || ts < 0) {
    return null;
  }
  return { phase, ts };
}

export function parseShortcut(message: HelperMessage): ShortcutName | null {
  return message['event'] === 'shortcut' && message['name'] === 'paste-last' ? 'paste-last' : null;
}

export function parseInputLost(message: HelperMessage): InputLostReason | null {
  const event = message['event'];
  return event === 'tap-reenabled' || event === 'tap-error' ? event : null;
}

export function parseRecordedHotkey(message: HelperMessage): HotkeyRecordResult | null {
  switch (message['event']) {
    case 'record-unsupported': return 'unsupported';
    case 'record-cancelled': return 'cancelled';
    case 'record-timeout': return 'timeout';
    case 'recorded': {
      const binding = { ...message };
      delete binding['event'];
      delete binding['recordingId'];
      delete binding['ts'];
      const parsed = parseHotkeySetting(binding);
      return parsed && !isReservedHotkey(parsed) ? parsed : 'unsupported';
    }
    default: return null;
  }
}

export function failureReason(message: HelperMessage): string {
  return nullableString(message, 'reason') ?? 'unknown';
}
