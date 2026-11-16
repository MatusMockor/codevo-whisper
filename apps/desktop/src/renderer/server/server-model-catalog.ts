import { grantModelsCommand, type PairedServerView } from '../../shared/server';
import type { CatalogEntry, ModelCatalog, ServerModelOutcome } from '../../shared/server-model-catalog';

export type ModelRowAction = { kind: 'download' | 'retry' | 'remove' | 'cancel'; label: string; disabled: boolean };

export type ServerModelRow = {
  id: string;
  name: string;
  size: string;
  hint: string;
  status: string;
  failed: boolean;
  percent: number | null;
  badge: string | null;
  action: ModelRowAction | null;
};

export type CatalogNotice = { text: string; command: string | null };

export type ServerModelsView = {
  rows: readonly ServerModelRow[];
  downloading: { name: string; percent: number } | null;
  notice: CatalogNotice | null;
  busyHint: string | null;
};

const TURBO = /-turbo(-|$)/;

const QUANTIZED = /-q8$/;

const GIGABYTE = 1_000_000_000;

const BUSY_HINT = 'Naraz sa sťahuje iba jeden model. Ďalší stiahnete, keď sa tento dokončí.';

const FORBIDDEN_NOTE = 'Toto zariadenie nemá povolené spravovať modely na serveri. Povoľte ho na serveri príkazom:';

const DISABLED_NOTE = 'Sťahovanie a odstraňovanie modelov je na serveri vypnuté (STT_MODEL_DOWNLOADS=disabled).';

const OUTCOME_MESSAGES: Readonly<Partial<Record<ServerModelOutcome, string>>> = Object.freeze({
  forbidden: 'Toto zariadenie nemá povolené spravovať modely na serveri.',
  downloads_disabled: DISABLED_NOTE,
  download_busy: 'Server práve sťahuje model. Skúste to znova, keď sťahovanie skončí.',
  insufficient_space: 'Na serveri nie je dosť miesta pre tento model.',
  model_in_use: 'Model sa práve používa na prepis. Skúste ho odstrániť o chvíľu.',
  model_not_removable: 'Predvolený model sa nedá odstrániť.',
  unknown_model: 'Server tento model nepozná. Skontrolujte, či na serveri beží aktuálna verzia Codevo Whisper.',
  stt_unavailable: 'Služba prepisu na serveri neodpovedá. Skúste to znova o chvíľu.',
  unreachable: 'Server sa nepodarilo kontaktovať. Skontrolujte spojenie a skúste to znova.',
  unsupported: 'Server správu modelov nepodporuje. Aktualizujte ho na verziu 0.6.0 alebo novšiu.',
});

export const OPERATION_FAILED = 'Požiadavku sa nepodarilo odoslať. Skúste to znova.';

export function modelOutcomeMessage(outcome: ServerModelOutcome): string | null {
  return OUTCOME_MESSAGES[outcome] ?? null;
}

export function formatGigabytes(bytes: number): string {
  return `${(bytes / GIGABYTE).toFixed(1).replace('.', ',')} GB`;
}

function familyHint(entry: Pick<CatalogEntry, 'id' | 'family'>): string {
  if (entry.family === 'parakeet') {
    return 'Rýchly, 25 európskych jazykov';
  }
  if (TURBO.test(entry.id)) {
    return 'Rýchlejší Whisper, rozpozná jazyk sám';
  }
  return 'Rozpozná jazyk sám';
}

export function catalogHint(entry: Pick<CatalogEntry, 'id' | 'family'>): string {
  if (QUANTIZED.test(entry.id)) {
    return `${familyHint(entry)}. Menší, takmer rovnaká presnosť.`;
  }
  return `${familyHint(entry)}.`;
}

export function downloadPercent(entry: Pick<CatalogEntry, 'sizeBytes' | 'receivedBytes'>): number {
  if (entry.sizeBytes <= 0 || entry.receivedBytes === null) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.floor((entry.receivedBytes / entry.sizeBytes) * 100)));
}

type Permissions = { manage: boolean; change: boolean; busy: boolean };

function permissionsOf(catalog: ModelCatalog): Permissions {
  return { manage: catalog.canManage, change: catalog.canManage && catalog.downloadsEnabled, busy: catalog.models.some((entry) => entry.state === 'downloading') };
}

function changeAction(kind: 'download' | 'retry', label: string, permissions: Permissions): ModelRowAction | null {
  if (!permissions.change) {
    return null;
  }
  return { kind, label, disabled: permissions.busy };
}

function installedRow(entry: CatalogEntry, permissions: Permissions): Pick<ServerModelRow, 'status' | 'badge' | 'action'> {
  if (!entry.removable) {
    return { status: 'Stiahnutý', badge: 'Predvolený', action: null };
  }
  return { status: 'Stiahnutý', badge: null, action: permissions.change ? { kind: 'remove', label: 'Odstrániť', disabled: false } : null };
}

function stateRow(entry: CatalogEntry, permissions: Permissions): Pick<ServerModelRow, 'status' | 'badge' | 'action'> {
  if (entry.state === 'installed') {
    return installedRow(entry, permissions);
  }
  if (entry.state === 'downloading') {
    return { status: `Sťahuje sa, ${downloadPercent(entry)} %`, badge: null, action: permissions.manage ? { kind: 'cancel', label: 'Zrušiť', disabled: false } : null };
  }
  if (entry.state === 'failed') {
    return { status: 'Sťahovanie zlyhalo', badge: null, action: changeAction('retry', 'Skúsiť znova', permissions) };
  }
  return { status: 'Nie je stiahnutý', badge: null, action: changeAction('download', 'Stiahnuť', permissions) };
}

function rowOf(entry: CatalogEntry, permissions: Permissions): ServerModelRow {
  return {
    id: entry.id,
    name: entry.name,
    size: formatGigabytes(entry.sizeBytes),
    hint: catalogHint(entry),
    failed: entry.state === 'failed',
    percent: entry.state === 'downloading' ? downloadPercent(entry) : null,
    ...stateRow(entry, permissions),
  };
}

function noticeOf(catalog: ModelCatalog, deviceId: string, linux: boolean): CatalogNotice | null {
  if (!catalog.canManage) {
    return { text: FORBIDDEN_NOTE, command: grantModelsCommand(deviceId, linux) };
  }
  if (!catalog.downloadsEnabled) {
    return { text: DISABLED_NOTE, command: null };
  }
  return null;
}

function downloadingOf(catalog: ModelCatalog): ServerModelsView['downloading'] {
  const running = catalog.models.find((entry) => entry.state === 'downloading');
  if (running === undefined) {
    return null;
  }
  return { name: running.name, percent: downloadPercent(running) };
}

export function serverCatalog(server: Pick<PairedServerView, 'status'>): ModelCatalog | null {
  const { status } = server;
  if (status.kind !== 'online' || status.modelCatalog === null || status.modelCatalog.models.length === 0) {
    return null;
  }
  return status.modelCatalog;
}

export function serverModelsView(server: Pick<PairedServerView, 'status' | 'deviceId'>, linux: boolean): ServerModelsView | null {
  const catalog = serverCatalog(server);
  if (catalog === null) {
    return null;
  }
  const permissions = permissionsOf(catalog);
  const rows = catalog.models.map((entry) => rowOf(entry, permissions));
  return {
    rows,
    downloading: downloadingOf(catalog),
    notice: noticeOf(catalog, server.deviceId, linux),
    busyHint: rows.some((row) => row.action?.disabled === true) ? BUSY_HINT : null,
  };
}
