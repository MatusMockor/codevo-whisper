import type { AppStatus } from '../../shared/app-status';
import type { DictationMode } from '../../shared/settings';

export type HotkeyVerb = 'Podržte' | 'Stlačte';

export type BannerContent = { kind: 'ready'; hotkeyLabel: string; verb: HotkeyVerb } | { kind: 'paused' } | { kind: 'action'; message: string };

export function hotkeyVerb(mode: DictationMode): HotkeyVerb {
  return mode === 'toggle' ? 'Stlačte' : 'Podržte';
}

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
  return { kind: 'ready', hotkeyLabel: status.hotkeyLabel, verb: hotkeyVerb(status.mode) };
}
