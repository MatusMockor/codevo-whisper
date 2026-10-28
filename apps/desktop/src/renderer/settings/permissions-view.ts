import type { PermissionGuide, PermissionsStatus } from '../../shared/permissions';

export type PermissionsView = PermissionsStatus & PermissionGuide & { hotkeyArmed: boolean };
