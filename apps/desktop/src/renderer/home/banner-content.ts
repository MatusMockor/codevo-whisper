import type { AppStatus } from '../../shared/app-status';
import type { DictationMode } from '../../shared/settings';

export type HotkeyVerb = 'Podržte' | 'Stlačte';

export type BannerTarget = 'settings' | 'server';

export type BannerContent = { kind: 'ready'; hotkeyLabel: string; verb: HotkeyVerb } | { kind: 'paused' } | { kind: 'action'; message: string; target: BannerTarget };

export function hotkeyVerb(mode: DictationMode): HotkeyVerb {
  return mode === 'hold' ? 'Podržte' : 'Stlačte';
}

export const ACTION_MESSAGES = {
  hotkey: 'Nastavte klávesovú skratku, ktorou budete diktovať.',
  model: 'Stiahnite si model na prepis reči.',
  server: 'Spárujte server na stránke Server alebo zmeňte, kde beží prepis.',
  repair: 'Server treba znova spárovať. Kým to neurobíte, Codevo Whisper naň neposiela zvuk.',
  permissions: 'Povoľte prístup k mikrofónu, monitorovaniu vstupu a prístupnosti.',
} as const;

function action(message: string, target: BannerTarget = 'settings'): BannerContent {
  return { kind: 'action', message, target };
}

export function bannerContent(status: AppStatus): BannerContent {
  if (status.serverRepairNeeded) {
    return action(ACTION_MESSAGES.repair, 'server');
  }
  if (status.hotkeyLabel === null) {
    return action(ACTION_MESSAGES.hotkey);
  }
  if (!status.modelReady && status.pairingNeeded) {
    return action(ACTION_MESSAGES.server, 'server');
  }
  if (!status.modelReady) {
    return action(ACTION_MESSAGES.model);
  }
  if (!status.permissionsOk) {
    return action(ACTION_MESSAGES.permissions);
  }
  if (status.paused) {
    return { kind: 'paused' };
  }
  return { kind: 'ready', hotkeyLabel: status.hotkeyLabel, verb: hotkeyVerb(status.mode) };
}
