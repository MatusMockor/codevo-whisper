import type { AppStatus } from '../../shared/app-status';
import type { PageId } from '../navigation';
import { bannerContent } from './banner-content';
import type { SignalState } from './transcription-route';

export type Readiness = { state: SignalState; label: string; hint: string | null };

export type PathHeader = { state: SignalState; label: string };

export type RailBadges = Partial<Record<PageId, SignalState>>;

export function readinessSummary(status: AppStatus): Readiness {
  const content = bannerContent(status);
  if (content.kind === 'ready') {
    return { state: 'ok', label: 'Pripravené', hint: `${content.verb.toLocaleLowerCase('sk-SK')} ${content.hotkeyLabel}` };
  }
  if (content.kind === 'paused') {
    return { state: 'off', label: 'Pozastavené', hint: null };
  }
  return { state: 'err', label: 'Diktovanie nefunguje', hint: null };
}

export function pathHeader(status: AppStatus): PathHeader {
  const content = bannerContent(status);
  if (content.kind === 'ready') {
    return { state: 'ok', label: 'signál prechádza' };
  }
  if (content.kind === 'paused') {
    return { state: 'off', label: 'pozastavené' };
  }
  return { state: 'err', label: 'signál sa prerušil' };
}

export function railBadges(status: AppStatus): RailBadges {
  const badges: RailBadges = {};
  if (bannerContent(status).kind === 'action') {
    badges.home = 'err';
  }
  if (status.serverRepairNeeded || status.pairingNeeded) {
    badges.server = 'err';
  }
  return badges;
}
