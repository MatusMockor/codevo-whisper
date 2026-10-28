import type { AppStatus } from '../../shared/app-status';
import { ACTION_MESSAGES } from '../home/banner-content';
import type { ModelState } from '../../shared/models';
import type { ServerView } from '../../shared/server';
import type { EngineId, Settings } from '../../shared/settings';

export type EngineChoice = 'local' | 'server' | 'later';

export type EngineChoiceOption = { id: EngineChoice; title: string; description: string };

export const ENGINE_CHOICES: readonly EngineChoiceOption[] = Object.freeze([
  { id: 'local', title: 'Na tomto Macu', description: 'Model sa raz stiahne z Hugging Face a potom prepisuje aj bez internetu. Zvuk neopustí počítač.' },
  { id: 'server', title: 'Na vlastnom serveri', description: 'Prepisuje váš spárovaný server, napríklad domáci počítač s grafickou kartou. Zvuk putuje zašifrovaný od začiatku do konca.' },
  { id: 'later', title: 'Nastavím neskôr', description: 'Teraz sa nič nesťahuje ani nepáruje.' },
]);

export const LATER_NOTE = 'Kedykoľvek neskôr si model stiahnete v Nastaveniach alebo spárujete server na stránke Server.';

export const TRY_HINTS = Object.freeze({
  model: 'Model sa ešte sťahuje alebo nie je vybraný. Diktovanie začne fungovať, keď bude pripravený.',
  server: 'Server zatiaľ nie je spárovaný. Diktovanie začne fungovať, keď ho spárujete v predchádzajúcom kroku alebo na stránke Server.',
  repair: ACTION_MESSAGES.repair,
  unset: 'Prepis zatiaľ nie je nastavený. Diktovanie začne fungovať, keď si v Nastaveniach stiahnete model alebo na stránke Server spárujete server.',
});

const STARTED_STATUSES: ReadonlySet<ModelState['status']> = new Set(['downloading', 'paused', 'ready']);

export function initialEngineChoice(settings: Pick<Settings, 'engineOrder' | 'localModelId'>, states: readonly ModelState[]): EngineChoice | null {
  if (settings.engineOrder[0] === 'server') {
    return 'server';
  }
  if (settings.localModelId !== null) {
    return 'local';
  }
  return states.some((state) => STARTED_STATUSES.has(state.status)) ? 'local' : null;
}

export function stickyEngineChoice(current: EngineChoice | null, derived: EngineChoice | null): EngineChoice | null {
  return current ?? derived;
}

export function engineOrderFor(choice: EngineChoice): EngineId[] | null {
  if (choice === 'later') {
    return null;
  }
  return [choice];
}

export function serverNeedsPairing(view: Pick<ServerView, 'server'>): boolean {
  return view.server === null || view.server.status.kind === 'repair-needed';
}

export function tryHint(choice: EngineChoice | null, status: AppStatus | null): string | null {
  if (status === null) {
    return null;
  }
  if (status.serverRepairNeeded) {
    return TRY_HINTS.repair;
  }
  if (status.modelReady) {
    return null;
  }
  if (status.pairingNeeded) {
    return TRY_HINTS.server;
  }
  return choice === 'local' ? TRY_HINTS.model : TRY_HINTS.unset;
}
