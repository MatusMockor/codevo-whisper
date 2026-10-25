import type { AppStatus } from '../../shared/app-status';

export type BannerContent = { kind: 'ready'; hotkeyLabel: string } | { kind: 'paused' } | { kind: 'action'; message: string };

export const ACTION_MESSAGES = {
  hotkey: 'Nastavte klávesovú skratku, ktorou budete diktovať.',
  model: 'Stiahnite si model na prepis reči.',
  permissions: 'Povoľte prístup k mikrofónu, monitorovaniu vstupu a prístupnosti.',
} as const;

export function bannerContent(status: AppStatus): BannerContent {
  if (status.hotkeyLabel === null) {
    return { kind: 'action', message: ACTION_MESSAGES.hotkey };
  }
  if (!status.modelReady) {
    return { kind: 'action', message: ACTION_MESSAGES.model };
  }
  if (!status.permissionsOk) {
    return { kind: 'action', message: ACTION_MESSAGES.permissions };
  }
  if (status.paused) {
    return { kind: 'paused' };
  }
  return { kind: 'ready', hotkeyLabel: status.hotkeyLabel };
}
