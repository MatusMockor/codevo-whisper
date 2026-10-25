export type MicrophonePermission = 'granted' | 'denied' | 'not-determined';

export type PermissionsStatus = { microphone: MicrophonePermission; inputMonitoring: boolean; accessibility: boolean };

export const PERMISSION_KINDS = ['microphone', 'input-monitoring', 'accessibility'] as const;

export type PermissionKind = (typeof PERMISSION_KINDS)[number];

export function allPermissionsGranted(status: PermissionsStatus): boolean {
  return status.microphone === 'granted' && status.inputMonitoring && status.accessibility;
}
