import { offeredActions, type BlockedReason, type OverlayAction, type OverlayError } from '../../shared/overlay-contract';
import type { EngineId } from '../../shared/settings';

export type MessageButton = { label: string; action: OverlayAction; primary: boolean };

export type BlockedCopy = { title: string; detail: string };

export const BLOCKED_COPY: Readonly<Record<BlockedReason, BlockedCopy>> = Object.freeze({
  focus: { title: 'Okno sa zmenilo, text nebol vložený', detail: 'Prepis je pripravený, vložte ho ručne.' },
  secure: { title: 'Zabezpečené zadávanie, text nebol vložený', detail: 'Prepis je pripravený, vložte ho ručne.' },
});

export const ACTION_LABELS: Readonly<Record<OverlayAction, string>> = Object.freeze({
  'open-settings': 'Otvoriť nastavenia',
  'open-languages': 'Otvoriť nastavenia',
  'open-server': 'Otvoriť server',
  'enable-server': 'Pripojiť server',
  'copy-last': 'Kopírovať doterajší text',
  'pair-server': 'Spárovať server',
  'download-model': 'Stiahnuť model',
  'use-server': 'Prepisovať na serveri',
  'use-local': 'Prepisovať lokálne',
});

export const REROUTED_TITLES: Readonly<Record<EngineId, string>> = Object.freeze({
  server: 'Prepis teraz beží na serveri',
  local: 'Prepis teraz beží lokálne',
});

export const REROUTED_DETAIL = 'Stlačte skratku a diktujte znova.';

export const PARTIAL_TEXT_DETAIL = 'Doterajší prepis sa nestratil.';

export const BLOCKED_BUTTONS: readonly MessageButton[] = Object.freeze([{ action: 'copy-last', label: 'Kopírovať', primary: true }]);

export function fallbackNotice(device: string): string {
  if (device === '') {
    return 'Vybraný mikrofón nie je pripojený, používam predvolený';
  }
  return `Mikrofón ${device} nie je pripojený, používam predvolený`;
}

export function copiedLabel(linux: boolean): string {
  return linux ? 'Skopírované - vlož cez Ctrl+V' : 'Skopírované - vlož cez ⌘V';
}

export function errorButtons(state: OverlayError): MessageButton[] {
  return offeredActions(state).map((action, index) => ({ action, label: ACTION_LABELS[action], primary: index === 0 }));
}

export function errorDetail(state: OverlayError): string | null {
  return state.action === 'copy-last' ? PARTIAL_TEXT_DETAIL : null;
}
