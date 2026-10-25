import type { Logger } from '../logging/logger';
import type { PermissionsService } from '../permissions/permissions-service';
import type { HotkeyService } from './hotkey-service';

export function rearmHotkeyOnGrant(permissions: Pick<PermissionsService, 'onChange'>, hotkey: Pick<HotkeyService, 'start' | 'isArmed'>, logger: Logger): () => void {
  return permissions.onChange((next) => {
    if (!next.inputMonitoring || hotkey.isArmed()) {
      return;
    }
    hotkey.start().catch((error: unknown) => {
      logger.error('The hotkey could not start after Input Monitoring was granted', error);
    });
  });
}
