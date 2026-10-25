import type { PermissionKind } from '../../shared/permissions';

const PRIVACY_PANE = 'x-apple.systempreferences:com.apple.preference.security';

export const MACOS_PERMISSION_LINKS: Readonly<Record<PermissionKind, string>> = Object.freeze({
  microphone: `${PRIVACY_PANE}?Privacy_Microphone`,
  'input-monitoring': `${PRIVACY_PANE}?Privacy_ListenEvent`,
  accessibility: `${PRIVACY_PANE}?Privacy_Accessibility`,
});
