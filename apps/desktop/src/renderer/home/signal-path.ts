import type { AppStatus } from '../../shared/app-status';
import type { PermissionsStatus } from '../../shared/permissions';
import type { DictationMode, InsertionMode, Settings } from '../../shared/settings';
import type { NavTarget } from '../navigation';
import { hotkeyVerb } from './banner-content';
import type { SignalState, TranscriptionRoute } from './transcription-route';

export type PathNodeId = 'microphone' | 'hotkey' | 'transcription' | 'ai' | 'insertion';

export type PathNode = { id: PathNodeId; index: string; name: string; state: SignalState; value: string; keyLabel: string | null; meta: string; target: NavTarget };

export type WireState = 'on' | 'dead' | 'broken';

export type PathInput = { status: AppStatus; settings: Settings; permissions: PermissionsStatus | null; route: TranscriptionRoute };

type NodeBody = Pick<PathNode, 'state' | 'value' | 'keyLabel' | 'meta'>;

export const DEFAULT_MICROPHONE = 'Systémový predvolený';

const MODE_META: Readonly<Record<DictationMode, string>> = {
  smart: 'inteligentný režim',
  hold: 'režim podržania',
  toggle: 'režim prepínania',
};

const INSERTION_LABELS: Readonly<Record<InsertionMode, string>> = {
  paste: 'Vložiť do aplikácie',
  type: 'Priame písanie',
  clipboard: 'Iba skopírovať',
};

function body(state: SignalState, value: string, meta: string, keyLabel: string | null = null): NodeBody {
  return { state, value, meta, keyLabel };
}

function microphone({ settings, permissions, status }: PathInput): NodeBody {
  const label = settings.microphone.label ?? DEFAULT_MICROPHONE;
  const access = permissions?.microphone ?? (status.permissionsOk ? 'granted' : null);
  if (access === 'denied') {
    return body('err', 'Prístup zamietnutý', label);
  }
  if (access === 'not-determined') {
    return body('warn', label, 'prístup ešte nepovolený');
  }
  if (access === null) {
    return body('warn', label, 'overujem prístup');
  }
  return body('ok', label, 'prístup povolený');
}

function missingKeyboardAccess(permissions: PermissionsStatus): string {
  return permissions.platform === 'linux' ? 'Chýba prístup ku klávesnici' : 'Chýba Monitorovanie vstupu';
}

function hotkey({ status, permissions }: PathInput): NodeBody {
  const meta = MODE_META[status.mode];
  if (status.hotkeyLabel === null) {
    return body('err', 'Nenastavená', meta);
  }
  if (permissions !== null && !permissions.inputMonitoring) {
    return body('err', missingKeyboardAccess(permissions), meta);
  }
  const verb = hotkeyVerb(status.mode).toLocaleLowerCase('sk-SK');
  if (status.paused) {
    return body('warn', verb, 'pozastavené z lišty', status.hotkeyLabel);
  }
  return body('ok', verb, meta, status.hotkeyLabel);
}

function transcription({ route }: PathInput): NodeBody {
  return body(route.state, route.label, route.detail);
}

function ai({ settings }: PathInput): NodeBody {
  if (!settings.aiPolish) {
    return body('off', 'Vypnutá', 'obídené');
  }
  if (settings.aiProvider === 'codex') {
    return body('ok', 'Codex CLI', settings.codexModel);
  }
  if (settings.aiBaseUrl === null || settings.aiModel === '') {
    return body('warn', 'Vlastný server', 'nie je nastavený');
  }
  return body('ok', 'Vlastný server', settings.aiModel);
}

function insertionMeta(settings: Settings): string {
  if (settings.insertion === 'clipboard') {
    return 'vložíte ručne';
  }
  if (settings.insertion === 'type') {
    return 'píše po znakoch';
  }
  return settings.clipboardPolicy === 'restore' ? 'schránka sa obnoví' : 'prepis ostane v schránke';
}

function needsAccessibility(settings: Settings, permissions: PermissionsStatus | null): boolean {
  if (permissions === null || permissions.platform === 'linux' || settings.insertion === 'clipboard') {
    return false;
  }
  return !permissions.accessibility;
}

function insertion({ settings, permissions }: PathInput): NodeBody {
  if (needsAccessibility(settings, permissions)) {
    return body('err', 'Chýba Prístupnosť', INSERTION_LABELS[settings.insertion]);
  }
  return body('ok', INSERTION_LABELS[settings.insertion], insertionMeta(settings));
}

type NodeSpec = { id: PathNodeId; name: string; read: (input: PathInput) => NodeBody; target: (input: PathInput) => NavTarget };

const NODES: readonly NodeSpec[] = [
  { id: 'microphone', name: 'Mikrofón', read: microphone, target: () => ({ page: 'settings', section: 'Mikrofón' }) },
  { id: 'hotkey', name: 'Skratka', read: hotkey, target: () => ({ page: 'settings', section: 'Diktovanie' }) },
  { id: 'transcription', name: 'Prepis', read: transcription, target: ({ route }) => route.target },
  { id: 'ai', name: 'AI úprava', read: ai, target: () => ({ page: 'settings', section: 'AI úprava textu' }) },
  { id: 'insertion', name: 'Vloženie', read: insertion, target: () => ({ page: 'settings', section: 'Vkladanie textu' }) },
];

export function signalPathNodes(input: PathInput): PathNode[] {
  return NODES.map((spec, position) => ({
    id: spec.id,
    index: String(position + 1).padStart(2, '0'),
    name: spec.name,
    ...spec.read(input),
    target: spec.target(input),
  }));
}

function wireState(alive: boolean, next: SignalState): WireState {
  if (!alive) {
    return 'dead';
  }
  return next === 'err' ? 'broken' : 'on';
}

export function pathWires(nodes: readonly PathNode[], paused: boolean): WireState[] {
  const wires: WireState[] = [];
  let alive = !paused && nodes[0]?.state !== 'err';
  for (const node of nodes.slice(1)) {
    wires.push(wireState(alive, node.state));
    alive = alive && node.state !== 'err';
  }
  return wires;
}
