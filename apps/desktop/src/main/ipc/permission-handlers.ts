import type { KeyRecorder } from '../hotkey/key-recorder';
import type { PermissionsService } from '../permissions/permissions-service';
import type { AppReveal } from '../system/app-reveal';
import type { HandlerGroup } from './invoke-handlers';
import { validatePermissionKind } from './validate';
import { withoutArguments } from './without-arguments';

export type PermissionHandlerDeps = {
  permissions: Pick<PermissionsService, 'status' | 'request' | 'openSettings' | 'asked'>;
  appReveal: Pick<AppReveal, 'available' | 'reveal'>;
  recorder: Pick<KeyRecorder, 'record'>;
  hotkey: { isArmed(): Promise<boolean> };
  relaunch: () => Promise<void>;
};

export function permissionHandlers({
  permissions,
  appReveal,
  recorder,
  hotkey,
  relaunch,
}: PermissionHandlerDeps): HandlerGroup<
  'getPermissions' | 'requestPermission' | 'openPermissionSettings' | 'getPermissionGuide' | 'revealAppInFinder' | 'relaunch' | 'recordHotkey' | 'isHotkeyArmed'
> {
  return {
    getPermissions: () => permissions.status(),
    requestPermission: (kind) => permissions.request(validatePermissionKind(kind)),
    openPermissionSettings: (kind) => permissions.openSettings(validatePermissionKind(kind)),
    getPermissionGuide: withoutArguments(async () => ({ asked: await permissions.asked(), canRevealApp: appReveal.available() })),
    revealAppInFinder: withoutArguments(() => appReveal.reveal()),
    relaunch: () => relaunch(),
    recordHotkey: () => recorder.record(),
    isHotkeyArmed: () => hotkey.isArmed(),
  };
}
