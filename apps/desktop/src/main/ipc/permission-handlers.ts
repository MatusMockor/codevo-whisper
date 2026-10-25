import type { KeyRecorder } from '../hotkey/key-recorder';
import type { PermissionsService } from '../permissions/permissions-service';
import type { HandlerGroup } from './invoke-handlers';
import { validatePermissionKind } from './validate';

export type PermissionHandlerDeps = {
  permissions: Pick<PermissionsService, 'status' | 'request' | 'openSettings'>;
  recorder: Pick<KeyRecorder, 'record'>;
  relaunch: () => Promise<void>;
};

export function permissionHandlers({ permissions, recorder, relaunch }: PermissionHandlerDeps): HandlerGroup<'getPermissions' | 'requestPermission' | 'openPermissionSettings' | 'relaunch' | 'recordHotkey'> {
  return {
    getPermissions: () => permissions.status(),
    requestPermission: (kind) => permissions.request(validatePermissionKind(kind)),
    openPermissionSettings: (kind) => permissions.openSettings(validatePermissionKind(kind)),
    relaunch: () => relaunch(),
    recordHotkey: () => recorder.record(),
  };
}
