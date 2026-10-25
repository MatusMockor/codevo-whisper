import type { HotkeyService } from '../hotkey/hotkey-service';
import type { KeyRecorder } from '../hotkey/key-recorder';
import type { PermissionsService } from '../permissions/permissions-service';
import type { HandlerGroup } from './invoke-handlers';
import { validatePermissionKind } from './validate';

export type PermissionHandlerDeps = {
  permissions: Pick<PermissionsService, 'status' | 'request' | 'openSettings'>;
  recorder: Pick<KeyRecorder, 'record'>;
  hotkey: Pick<HotkeyService, 'isArmed'>;
  relaunch: () => Promise<void>;
};

export function permissionHandlers({
  permissions,
  recorder,
  hotkey,
  relaunch,
}: PermissionHandlerDeps): HandlerGroup<'getPermissions' | 'requestPermission' | 'openPermissionSettings' | 'relaunch' | 'recordHotkey' | 'isHotkeyArmed'> {
  return {
    getPermissions: () => permissions.status(),
    requestPermission: (kind) => permissions.request(validatePermissionKind(kind)),
    openPermissionSettings: (kind) => permissions.openSettings(validatePermissionKind(kind)),
    relaunch: () => relaunch(),
    recordHotkey: () => recorder.record(),
    isHotkeyArmed: () => Promise.resolve(hotkey.isArmed()),
  };
}
