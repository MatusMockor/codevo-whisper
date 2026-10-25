import type { HelperMessage } from './helper-channel';
import type { AppTarget, FocusedElement, InputLostReason, KeyEvent, Permissions, ShortcutName } from './input-helper';

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

export function parseKeyEvent(message: HelperMessage): KeyEvent | null {
  const phase = message['phase'];
  const keycode = nullableInteger(message, 'keycode');
  if (message['event'] !== 'key' || (phase !== 'down' && phase !== 'up') || keycode === null) {
    return null;
  }
  return { phase, keycode, ts: nullableInteger(message, 'ts') ?? Date.now() };
}

export function parseShortcut(message: HelperMessage): ShortcutName | null {
  return message['event'] === 'shortcut' && message['name'] === 'paste-last' ? 'paste-last' : null;
}

export function parseInputLost(message: HelperMessage): InputLostReason | null {
  const event = message['event'];
  return event === 'tap-reenabled' || event === 'tap-error' ? event : null;
}

export function parseRecordedKey(message: HelperMessage): number | null {
  if (message['event'] !== 'recorded' && message['event'] !== 'record-unsupported') {
    return null;
  }
  return nullableInteger(message, 'keycode');
}

export function failureReason(message: HelperMessage): string {
  return nullableString(message, 'reason') ?? 'unknown';
}
