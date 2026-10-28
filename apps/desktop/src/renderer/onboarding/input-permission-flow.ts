import type { InputPermissionKind } from '../../shared/permissions';
import type { PermissionsView } from '../settings/permissions-view';

export type InputPermissionAction = { run: 'request' | 'open-settings'; label: string };

export type RelaunchReason = 'pending' | 'unarmed';

const REQUEST_ACTION: InputPermissionAction = Object.freeze({ run: 'request', label: 'Povoliť' });

const OPEN_SETTINGS_ACTION: InputPermissionAction = Object.freeze({ run: 'open-settings', label: 'Otvoriť Nastavenia systému' });

export function isGranted(view: PermissionsView, kind: InputPermissionKind): boolean {
  return kind === 'input-monitoring' ? view.inputMonitoring : view.accessibility;
}

export function wasAsked(view: PermissionsView, kind: InputPermissionKind): boolean {
  return view.asked.includes(kind);
}

export function inputPermissionAction(view: PermissionsView, kind: InputPermissionKind): InputPermissionAction {
  return wasAsked(view, kind) ? OPEN_SETTINGS_ACTION : REQUEST_ACTION;
}

export function offersManualAdd(view: PermissionsView, kind: InputPermissionKind): boolean {
  return view.canRevealApp && wasAsked(view, kind) && !isGranted(view, kind);
}

export function relaunchReason(view: PermissionsView): RelaunchReason | null {
  if (view.inputMonitoring) {
    return view.hotkeyArmed ? null : 'unarmed';
  }
  return wasAsked(view, 'input-monitoring') ? 'pending' : null;
}
