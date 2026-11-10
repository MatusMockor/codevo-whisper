import type { EngineRemedy, EngineRemedyAction } from '../../shared/engine-routing';
import type { EngineId } from '../../shared/settings';
import { MODEL_SECTION, SERVER_SECTION, type NavTarget } from '../navigation';
import type { ActionContent } from './banner-content';

export type ReadinessCommand = { kind: 'navigate'; target: NavTarget } | { kind: 'prefer-engine'; engine: EngineId } | { kind: 'enable-server' };

export type ReadinessAction = { id: string; label: string; command: ReadinessCommand; primary: boolean };

export type CommandHandlers = { navigate: (target: NavTarget) => void; prefer: (engine: EngineId) => void; enableServer: () => void };

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
  'download-model': { label: () => 'Stiahnuť model', command: { kind: 'navigate', target: MODEL_SECTION } },
  'pair-server': { label: () => 'Spárovať server', command: { kind: 'navigate', target: SERVER_SECTION } },
  'open-server': { label: () => 'Otvoriť server', command: { kind: 'navigate', target: SERVER_SECTION } },
  'enable-server': { label: () => 'Pripojiť server', command: { kind: 'enable-server' } },
});

function remedyAction(action: EngineRemedyAction, serverHost: string | null, primary: boolean): ReadinessAction {
  const button = REMEDY_BUTTONS[action];
  return { id: action, label: button.label(serverHost), command: button.command, primary };
}

function openLink(target: NavTarget): Pick<ReadinessAction, 'id' | 'label'> {
  if (target.page === 'settings') {
    return { id: 'open-settings', label: 'Otvoriť nastavenia' };
  }
  if (target.section === 'server') {
    return { id: 'open-server', label: 'Otvoriť server' };
  }
  return { id: 'open-transcription', label: 'Otvoriť Prepis' };
}

function openAction(target: NavTarget): ReadinessAction {
  return { ...openLink(target), command: { kind: 'navigate', target }, primary: true };
}

export function remedyActions(remedy: EngineRemedy, serverHost: string | null): ReadinessAction[] {
  const primary = remedyAction(remedy.action, serverHost, true);
  if (remedy.alternative === undefined) {
    return [primary];
  }
  return [remedyAction(remedy.alternative, serverHost, false), primary];
}

export function readinessActions(content: ActionContent): ReadinessAction[] {
  const remedy = content.issue?.remedy ?? null;
  if (remedy === null) {
    return [openAction(content.target)];
  }
  return remedyActions(remedy, content.issue?.serverHost ?? null);
}

export function runCommand(command: ReadinessCommand, handlers: CommandHandlers): void {
  if (command.kind === 'prefer-engine') {
    handlers.prefer(command.engine);
    return;
  }
  if (command.kind === 'enable-server') {
    handlers.enableServer();
    return;
  }
  handlers.navigate(command.target);
}
