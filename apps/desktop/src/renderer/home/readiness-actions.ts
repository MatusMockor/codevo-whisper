import type { EngineRemedyAction } from '../../shared/engine-routing';
import type { EngineId } from '../../shared/settings';
import type { NavTarget } from '../navigation';
import type { ActionContent } from './banner-content';

export type ReadinessCommand = { kind: 'navigate'; target: NavTarget } | { kind: 'prefer-engine'; engine: EngineId };

export type ReadinessAction = { id: string; label: string; command: ReadinessCommand; primary: boolean };

type RemedyButton = { label: (serverHost: string | null) => string; command: ReadinessCommand };

function serverLabel(serverHost: string | null): string {
  if (serverHost === null) {
    return 'Prepisovať na serveri';
  }
  return `Prepisovať na serveri ${serverHost}`;
}

const REMEDY_BUTTONS: Readonly<Record<EngineRemedyAction, RemedyButton>> = Object.freeze({
  'use-server': { label: serverLabel, command: { kind: 'prefer-engine', engine: 'server' } },
  'use-local': { label: () => 'Prepisovať lokálne', command: { kind: 'prefer-engine', engine: 'local' } },
  'download-model': { label: () => 'Stiahnuť model', command: { kind: 'navigate', target: { page: 'settings', section: 'local-model' } } },
  'pair-server': { label: () => 'Spárovať server', command: { kind: 'navigate', target: { page: 'server' } } },
  'open-server': { label: () => 'Otvoriť Server', command: { kind: 'navigate', target: { page: 'server' } } },
});

function remedyAction(action: EngineRemedyAction, serverHost: string | null, primary: boolean): ReadinessAction {
  const button = REMEDY_BUTTONS[action];
  return { id: action, label: button.label(serverHost), command: button.command, primary };
}

function openAction(target: NavTarget): ReadinessAction {
  const command: ReadinessCommand = { kind: 'navigate', target };
  if (target.page === 'server') {
    return { id: 'open-server', label: 'Otvoriť Server', command, primary: true };
  }
  return { id: 'open-settings', label: 'Otvoriť nastavenia', command, primary: true };
}

export function readinessActions(content: ActionContent): ReadinessAction[] {
  const remedy = content.issue?.remedy ?? null;
  if (remedy === null) {
    return [openAction(content.target)];
  }
  const serverHost = content.issue?.serverHost ?? null;
  const primary = remedyAction(remedy.action, serverHost, true);
  if (remedy.alternative === undefined) {
    return [primary];
  }
  return [remedyAction(remedy.alternative, serverHost, false), primary];
}
