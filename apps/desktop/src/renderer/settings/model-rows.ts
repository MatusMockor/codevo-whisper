import type { ModelInfo, ModelState } from '../../shared/models';

export type ModelAction = 'download' | 'pause' | 'continue' | 'delete' | 'activate';

export type ModelActionButton = { action: ModelAction; label: string; disabled: boolean };

export type ModelRowContext = { activeId: string | null; busyId: string | null };

export type ModelRow = {
  id: string;
  name: string;
  roles: readonly string[];
  size: string;
  license: string;
  status: string;
  progress: number | null;
  active: boolean;
  actions: ModelActionButton[];
};

const DECIMAL = new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 1 });

const GIGABYTE = 1_000_000_000;

const MEGABYTE = 1_000_000;

export function formatSize(bytes: number): string {
  if (bytes >= GIGABYTE) {
    return `${DECIMAL.format(bytes / GIGABYTE)} GB`;
  }
  return `${Math.round(bytes / MEGABYTE)} MB`;
}

function fraction(state: ModelState): number {
  return state.totalBytes > 0 ? Math.min(1, state.receivedBytes / state.totalBytes) : 0;
}

function percent(state: ModelState): string {
  return `${Math.floor(fraction(state) * 100)} %`;
}

function button(action: ModelAction, label: string, disabled = false): ModelActionButton {
  return { action, label, disabled };
}

function otherBusy(state: ModelState, context: ModelRowContext): boolean {
  return context.busyId !== null && context.busyId !== state.id;
}

function stateView(state: ModelState, context: ModelRowContext): Pick<ModelRow, 'status' | 'progress' | 'actions'> {
  const remove = button('delete', 'Odstrániť');
  if (state.status === 'downloading') {
    return { status: `Sťahuje sa, ${percent(state)}`, progress: fraction(state), actions: [button('pause', 'Pozastaviť'), remove] };
  }
  if (state.status === 'paused') {
    return { status: `Pozastavené, ${percent(state)}`, progress: fraction(state), actions: [button('continue', 'Pokračovať', otherBusy(state, context)), remove] };
  }
  if (state.status === 'broken') {
    return { status: 'Súbor je poškodený', progress: null, actions: [button('download', 'Stiahnuť znova', otherBusy(state, context)), remove] };
  }
  if (state.status === 'ready' && context.activeId === state.id) {
    return { status: 'Používa sa', progress: null, actions: [remove] };
  }
  if (state.status === 'ready') {
    return { status: 'Stiahnutý', progress: null, actions: [button('activate', 'Použiť'), remove] };
  }
  return { status: 'Nestiahnutý', progress: null, actions: [button('download', 'Stiahnuť', otherBusy(state, context))] };
}

export function modelRow(model: ModelInfo, state: ModelState, context: ModelRowContext): ModelRow {
  return {
    id: model.id,
    name: model.name,
    roles: model.roleLabels,
    size: formatSize(model.sizeBytes),
    license: model.license,
    active: state.status === 'ready' && context.activeId === model.id,
    ...stateView(state, context),
  };
}

export function busyModelId(states: readonly ModelState[]): string | null {
  return states.find((state) => state.status === 'downloading')?.id ?? null;
}
