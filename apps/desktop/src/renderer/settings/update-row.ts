import type { InstallOutcome, UpdateFailure, UpdatePhase, UpdateStatus } from '../../shared/updates';

export type UpdateActionId = 'check' | 'install' | 'download';

export type UpdateAction = { id: UpdateActionId; label: string; primary: boolean; disabled: boolean };

export type UpdateRowView = { description: string; actions: UpdateAction[] };

type PhaseOf<K extends UpdatePhase['kind']> = Extract<UpdatePhase, { kind: K }>;

type PhaseViews = { [K in UpdatePhase['kind']]: (phase: PhaseOf<K>, status: UpdateStatus) => UpdateRowView };

const check = (disabled = false): UpdateAction => ({ id: 'check', label: 'Skontrolovať aktualizácie', primary: false, disabled });

const install = (disabled = false): UpdateAction => ({ id: 'install', label: 'Reštartovať a aktualizovať', primary: true, disabled });

const DOWNLOAD: UpdateAction = { id: 'download', label: 'Stiahnuť z GitHubu', primary: true, disabled: false };

const FAILURES: Readonly<Record<UpdateFailure, (status: UpdateStatus) => string>> = {
  check: () => 'Aktualizácie sa nepodarilo skontrolovať. Skúste to neskôr.',
  download: () => 'Aktualizáciu sa nepodarilo stiahnuť. Skúste to znova.',
  install: (status) => `Aktualizáciu sa nepodarilo nainštalovať. Zostáva verzia ${status.currentVersion}.`,
};

function idleDescription(checked: boolean, version: string): string {
  return checked ? `Verzia ${version} je najnovšia.` : `Verzia ${version}. Aktualizácie sa kontrolujú automaticky.`;
}

const PHASE_VIEWS: PhaseViews = {
  idle: (phase, status) => ({ description: idleDescription(phase.checked, status.currentVersion), actions: [check()] }),
  checking: (_phase, status) => ({ description: `Verzia ${status.currentVersion}. Hľadám aktualizácie…`, actions: [check(true)] }),
  available: (phase) => ({ description: `Je dostupná verzia ${phase.version}. Stiahnite ju z GitHubu a nainštalujte.`, actions: [DOWNLOAD, check()] }),
  downloading: (phase) => ({ description: `Sťahujem verziu ${phase.version}… ${phase.percent} %`, actions: [check(true)] }),
  ready: (phase) => ({ description: `Verzia ${phase.version} je pripravená. Nainštaluje sa po reštarte.`, actions: [install()] }),
  installing: (phase) => ({ description: `Reštartujem a inštalujem verziu ${phase.version}…`, actions: [install(true)] }),
  stalled: (phase) => ({ description: `Inštalácia verzie ${phase.version} sa nedokončila. Ukončite Codevo Whisper a spustite ho znova.`, actions: [] }),
  error: (phase, status) => ({ description: FAILURES[phase.failed](status), actions: [check()] }),
};

function phaseView<K extends UpdatePhase['kind']>(phase: PhaseOf<K>, status: UpdateStatus): UpdateRowView {
  const view = PHASE_VIEWS[phase.kind] as (phase: PhaseOf<K>, status: UpdateStatus) => UpdateRowView;
  return view(phase, status);
}

export function updateRowView(status: UpdateStatus, notice: InstallOutcome | null): UpdateRowView {
  const { phase } = status;
  if (status.mode === 'unsupported') {
    return { description: `Verzia ${status.currentVersion}. Aktualizácie fungujú iba v nainštalovanej aplikácii.`, actions: [check(true)] };
  }
  if (phase.kind === 'ready' && notice === 'dictation-active') {
    return { description: `Verzia ${phase.version} je pripravená. Po dokončení diktovania to skúste znova.`, actions: [install()] };
  }
  return phaseView(phase, status);
}
