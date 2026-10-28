export type MicrophonePermission = 'granted' | 'denied' | 'not-determined';

export type PermissionsStatus = { microphone: MicrophonePermission; inputMonitoring: boolean; accessibility: boolean };

export const PERMISSION_KINDS = ['microphone', 'input-monitoring', 'accessibility'] as const;

export type PermissionKind = (typeof PERMISSION_KINDS)[number];

export function allPermissionsGranted(status: PermissionsStatus): boolean {
  return status.microphone === 'granted' && status.inputMonitoring && status.accessibility;
}

export const INPUT_PERMISSION_KINDS = ['input-monitoring', 'accessibility'] as const;

export type InputPermissionKind = (typeof INPUT_PERMISSION_KINDS)[number];

export type PermissionGuide = { asked: InputPermissionKind[]; canRevealApp: boolean };

export function isInputPermissionKind(value: unknown): value is InputPermissionKind {
  return INPUT_PERMISSION_KINDS.some((kind) => kind === value);
}
