import type { InstallOutcome, UpdatePhase, UpdateStatus } from '../../shared/updates';

export type UpdateIndicatorActionId = 'install' | 'download';

export type UpdateIndicatorAction = { id: UpdateIndicatorActionId; label: string; disabled: boolean };

export type UpdateIndicatorView = { message: string; note: string | null; percent: number | null; action: UpdateIndicatorAction | null };

type PhaseOf<K extends UpdatePhase['kind']> = Extract<UpdatePhase, { kind: K }>;

const DICTATION_NOTE = 'Po dokončení diktovania to skúste znova.';

function downloading(phase: PhaseOf<'downloading'>): UpdateIndicatorView {
  return { message: `Sťahujem aktualizáciu… ${phase.percent} %`, note: null, percent: phase.percent, action: null };
}

function ready(phase: PhaseOf<'ready'>, notice: InstallOutcome | null): UpdateIndicatorView {
  return {
    message: `Aktualizácia ${phase.version} je pripravená`,
    note: notice === 'dictation-active' ? DICTATION_NOTE : null,
    percent: null,
    action: { id: 'install', label: 'Reštartovať', disabled: false },
  };
}

function installing(phase: PhaseOf<'installing'>): UpdateIndicatorView {
  return { message: `Aktualizácia ${phase.version} je pripravená`, note: null, percent: null, action: { id: 'install', label: 'Reštartujem…', disabled: true } };
}

function available(phase: PhaseOf<'available'>): UpdateIndicatorView {
  return { message: `Je dostupná verzia ${phase.version}`, note: null, percent: null, action: { id: 'download', label: 'Stiahnuť z GitHubu', disabled: false } };
}

export function updateIndicatorView(status: UpdateStatus, notice: InstallOutcome | null): UpdateIndicatorView | null {
  const { phase, mode } = status;
  if (mode === 'unsupported') {
    return null;
  }
  if (phase.kind === 'downloading') {
    return downloading(phase);
  }
  if (phase.kind === 'ready') {
    return ready(phase, notice);
  }
  if (phase.kind === 'installing') {
    return installing(phase);
  }
  if (phase.kind === 'available' && mode === 'manual') {
    return available(phase);
  }
  return null;
}
