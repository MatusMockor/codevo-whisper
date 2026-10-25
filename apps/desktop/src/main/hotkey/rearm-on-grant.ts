import type { Logger } from '../logging/logger';
import type { PermissionsService } from '../permissions/permissions-service';
import type { HotkeyService } from './hotkey-service';

export function rearmHotkeyOnGrant(permissions: Pick<PermissionsService, 'onRead'>, hotkey: Pick<HotkeyService, 'start' | 'isArmed'>, logger: Logger): () => void {
  let starting = false;
  return permissions.onRead((next) => {
    if (!next.inputMonitoring || hotkey.isArmed() || starting) {
      return;
    }
    starting = true;
    hotkey
      .start()
      .catch((error: unknown) => {
        logger.error('The hotkey could not start after Input Monitoring was granted', error);
      })
      .finally(() => {
        starting = false;
      });
  });
}
