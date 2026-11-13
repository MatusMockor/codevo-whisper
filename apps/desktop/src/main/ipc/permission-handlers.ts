import type { KeyRecorder } from '../hotkey/key-recorder';
import type { PermissionsService } from '../permissions/permissions-service';
import { overlapsHotkey, recordedSessionBinding } from '../session/session-shortcuts';
import type { SettingsStore } from '../settings/settings-store';
import { overlaps, REBINDABLE_ACTIONS, type RebindableAction, type SessionShortcutRecordResult } from '../../shared/session-shortcuts';
import type { AppReveal } from '../system/app-reveal';
import type { HandlerGroup } from './invoke-handlers';
import { validatePermissionKind, validateRebindableAction } from './validate';
import { withoutArguments } from './without-arguments';

export type PermissionHandlerDeps = {
  permissions: Pick<PermissionsService, 'status' | 'request' | 'openSettings' | 'asked'>;
  appReveal: Pick<AppReveal, 'available' | 'reveal'>;
  recorder: Pick<KeyRecorder, 'record'>;
  hotkey: { isArmed(): Promise<boolean> };
  relaunch: () => Promise<void>;
  settings: Pick<SettingsStore, 'get'>;
  platform?: NodeJS.Platform;
};

export function permissionHandlers({
  permissions,
  appReveal,
  recorder,
  hotkey,
  relaunch,
  settings,
  platform = process.platform,
}: PermissionHandlerDeps): HandlerGroup<
  'getPermissions' | 'requestPermission' | 'openPermissionSettings' | 'getPermissionGuide' | 'revealAppInFinder' | 'relaunch' | 'recordHotkey' | 'recordSessionShortcut' | 'isHotkeyArmed'
> {
  async function recordSessionShortcut(action: RebindableAction): Promise<SessionShortcutRecordResult> {
    const recorded = await recorder.record();
    if (typeof recorded === 'string') return recorded;
    const binding = recordedSessionBinding(recorded, platform);
    if (binding === null) return 'unsupported';
    const current = settings.get();
    const others = REBINDABLE_ACTIONS.filter((other) => other !== action).map((other) => current.sessionShortcuts[other]);
    return others.some((other) => overlaps(binding, other)) || overlapsHotkey(binding, current.hotkey, platform) ? 'conflict' : binding;
  }

  return {
    getPermissions: () => permissions.status(),
    requestPermission: (kind) => permissions.request(validatePermissionKind(kind)),
    openPermissionSettings: (kind) => permissions.openSettings(validatePermissionKind(kind)),
    getPermissionGuide: withoutArguments(async () => ({ asked: await permissions.asked(), canRevealApp: appReveal.available() })),
    revealAppInFinder: withoutArguments(() => appReveal.reveal()),
    relaunch: () => relaunch(),
    recordHotkey: () => recorder.record(),
    recordSessionShortcut: (action) => recordSessionShortcut(validateRebindableAction(action)),
    isHotkeyArmed: () => hotkey.isArmed(),
  };
}
