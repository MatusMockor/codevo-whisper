import type { AppStatus } from '../../shared/app-status';
import type { EngineProblem } from '../../shared/engine-routing';
import type { DictationMode } from '../../shared/settings';
import type { NavTarget } from '../navigation';
import { ISSUE_TARGETS, type EngineIssue } from './engine-issue';

export type HotkeyVerb = 'Podržte' | 'Stlačte';

export type ActionContent = { kind: 'action'; message: string; target: NavTarget; issue: EngineIssue | null };

export type BannerContent = { kind: 'ready'; hotkeyLabel: string; verb: HotkeyVerb } | { kind: 'paused' } | ActionContent;

export function hotkeyVerb(mode: DictationMode): HotkeyVerb {
  return mode === 'hold' ? 'Podržte' : 'Stlačte';
}

export const ACTION_MESSAGES = {
  hotkey: 'Nastavte klávesovú skratku, ktorou budete diktovať.',
  repair: 'Server treba znova spárovať. Kým to neurobíte, Codevo Whisper naň neposiela zvuk.',
  permissions: 'Povoľte prístup k mikrofónu, monitorovaniu vstupu a prístupnosti.',
} as const;

export const ENGINE_MESSAGES: Readonly<Record<EngineProblem, string>> = Object.freeze({
  'no-model': 'Lokálny model nie je stiahnutý.',
  'server-not-paired': 'Server nie je spárovaný.',
  'server-offline': 'Server nie je dostupný.',
});

function action(message: string, target: NavTarget): ActionContent {
  return { kind: 'action', message, target, issue: null };
}

function engineAction(issue: EngineIssue): ActionContent {
  return { kind: 'action', message: ENGINE_MESSAGES[issue.problem], target: ISSUE_TARGETS[issue.problem], issue };
}

export function bannerContent(status: AppStatus, issue: EngineIssue | null): BannerContent {
  if (status.serverRepairNeeded) {
    return action(ACTION_MESSAGES.repair, { page: 'server' });
  }
  if (status.hotkeyLabel === null) {
    return action(ACTION_MESSAGES.hotkey, { page: 'settings', section: 'dictation' });
  }
  if (issue !== null) {
    return engineAction(issue);
  }
  if (!status.permissionsOk) {
    return action(ACTION_MESSAGES.permissions, { page: 'settings' });
  }
  if (status.paused) {
    return { kind: 'paused' };
  }
  return { kind: 'ready', hotkeyLabel: status.hotkeyLabel, verb: hotkeyVerb(status.mode) };
}
