import { describe, expect, it } from 'vitest';
import { pathWires, signalPathNodes, type PathInput, type PathNode, type PathNodeId } from '../src/renderer/home/signal-path';
import type { TranscriptionRoute } from '../src/renderer/home/transcription-route';
import type { AppStatus } from '../src/shared/app-status';
import type { PermissionsStatus } from '../src/shared/permissions';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';

const STATUS: AppStatus = { hotkeyLabel: '⌥Space', mode: 'smart', modelReady: true, pairingNeeded: false, serverRepairNeeded: false, permissionsOk: true, paused: false };
const GRANTED: PermissionsStatus = { microphone: 'granted', inputMonitoring: true, accessibility: true };
const ROUTE: TranscriptionRoute = { state: 'ok', label: 'Server domáci-pc', detail: '38 ms · E2E', latencyMs: 38, target: { page: 'settings', section: 'engine' } };

function input(patch: { status?: Partial<AppStatus>; settings?: Partial<Settings>; permissions?: PermissionsStatus | null; route?: TranscriptionRoute } = {}): PathInput {
  return {
    status: { ...STATUS, ...patch.status },
    settings: { ...DEFAULT_SETTINGS, ...patch.settings },
    permissions: patch.permissions === undefined ? GRANTED : patch.permissions,
    route: patch.route ?? ROUTE,
  };
}

function node(nodes: PathNode[], id: PathNodeId): PathNode | undefined {
  return nodes.find((candidate) => candidate.id === id);
}

describe('signalPathNodes', () => {
  it('walks the five steps in order with their configuration targets', () => {
    const nodes = signalPathNodes(input());

    expect(nodes.map((entry) => [entry.index, entry.name, entry.state])).toEqual([
      ['01', 'Mikrofón', 'ok'],
      ['02', 'Skratka', 'ok'],
      ['03', 'Prepis', 'ok'],
      ['04', 'AI úprava', 'off'],
      ['05', 'Vloženie', 'ok'],
    ]);
    expect(nodes.map((entry) => entry.target)).toEqual([
      { page: 'settings', section: 'microphone' },
      { page: 'settings', section: 'dictation' },
      { page: 'settings', section: 'engine' },
      { page: 'settings', section: 'ai' },
      { page: 'settings', section: 'insertion' },
    ]);
  });

  it('shows the microphone and its access', () => {
    expect(node(signalPathNodes(input()), 'microphone')).toMatchObject({ value: 'Systémový predvolený', meta: 'prístup povolený' });
    expect(node(signalPathNodes(input({ settings: { microphones: [{ deviceId: 'usb', label: 'Rode NT-USB' }] } })), 'microphone')).toMatchObject({ value: 'Rode NT-USB' });
    expect(node(signalPathNodes(input({ permissions: { ...GRANTED, microphone: 'denied' } })), 'microphone')).toMatchObject({ state: 'err', value: 'Prístup zamietnutý' });
    expect(node(signalPathNodes(input({ permissions: { ...GRANTED, microphone: 'not-determined' } })), 'microphone')).toMatchObject({ state: 'warn', meta: 'prístup ešte nepovolený' });
    expect(node(signalPathNodes(input({ permissions: null })), 'microphone')).toMatchObject({ state: 'ok' });
    expect(node(signalPathNodes(input({ permissions: null, status: { permissionsOk: false } })), 'microphone')).toMatchObject({ state: 'warn', meta: 'overujem prístup' });
  });

  it('shows the hotkey, its mode and what blocks it', () => {
    expect(node(signalPathNodes(input()), 'hotkey')).toMatchObject({ state: 'ok', keyLabel: '⌥Space', value: 'stlačte', meta: 'inteligentný režim' });
    expect(node(signalPathNodes(input({ status: { mode: 'hold' } })), 'hotkey')).toMatchObject({ value: 'podržte', meta: 'režim podržania' });
    expect(node(signalPathNodes(input({ status: { hotkeyLabel: null } })), 'hotkey')).toMatchObject({ state: 'err', value: 'Nenastavená', keyLabel: null });
    expect(node(signalPathNodes(input({ permissions: { ...GRANTED, inputMonitoring: false } })), 'hotkey')).toMatchObject({ state: 'err', value: 'Chýba Monitorovanie vstupu' });
    expect(node(signalPathNodes(input({ permissions: { ...GRANTED, inputMonitoring: false, platform: 'linux' } })), 'hotkey')).toMatchObject({ value: 'Chýba prístup ku klávesnici' });
    expect(node(signalPathNodes(input({ status: { paused: true } })), 'hotkey')).toMatchObject({ state: 'warn', meta: 'pozastavené z lišty' });
  });

  it('mirrors the transcription route', () => {
    const route: TranscriptionRoute = { state: 'err', label: 'Lokálne · model chýba', detail: 'kliknite a opravte', latencyMs: null, target: { page: 'settings', section: 'local-model' } };

    expect(node(signalPathNodes(input({ route })), 'transcription')).toMatchObject({ state: 'err', value: 'Lokálne · model chýba', target: { page: 'settings', section: 'local-model' } });
  });

  it('describes the AI polish provider', () => {
    expect(node(signalPathNodes(input()), 'ai')).toMatchObject({ state: 'off', value: 'Vypnutá', meta: 'obídené' });
    expect(node(signalPathNodes(input({ settings: { aiPolish: true, aiProvider: 'codex', codexModel: 'gpt-6-luna' } })), 'ai')).toMatchObject({ state: 'ok', value: 'Codex CLI', meta: 'gpt-6-luna' });
    expect(node(signalPathNodes(input({ settings: { aiPolish: true, aiBaseUrl: 'http://localhost:11434/v1', aiModel: 'qwen3' } })), 'ai')).toMatchObject({ state: 'ok', value: 'Vlastný server', meta: 'qwen3' });
    expect(node(signalPathNodes(input({ settings: { aiPolish: true } })), 'ai')).toMatchObject({ state: 'warn', meta: 'nie je nastavený' });
  });

  it('describes insertion and the missing accessibility permission', () => {
    expect(node(signalPathNodes(input()), 'insertion')).toMatchObject({ state: 'ok', value: 'Vložiť do aplikácie', meta: 'schránka sa obnoví' });
    expect(node(signalPathNodes(input({ settings: { clipboardPolicy: 'leave' } })), 'insertion')).toMatchObject({ meta: 'prepis ostane v schránke' });
    expect(node(signalPathNodes(input({ settings: { insertion: 'type' } })), 'insertion')).toMatchObject({ value: 'Priame písanie', meta: 'píše po znakoch' });
    expect(node(signalPathNodes(input({ settings: { insertion: 'clipboard' }, permissions: { ...GRANTED, accessibility: false } })), 'insertion')).toMatchObject({ state: 'ok', value: 'Iba skopírovať', meta: 'vložíte ručne' });
    expect(node(signalPathNodes(input({ permissions: { ...GRANTED, accessibility: false } })), 'insertion')).toMatchObject({ state: 'err', value: 'Chýba Prístupnosť' });
    expect(node(signalPathNodes(input({ permissions: { ...GRANTED, accessibility: false, platform: 'linux' } })), 'insertion')).toMatchObject({ state: 'ok' });
  });
});

describe('pathWires', () => {
  it('carries the signal until the first broken step', () => {
    expect(pathWires(signalPathNodes(input()), false)).toEqual(['on', 'on', 'on', 'on']);
    expect(pathWires(signalPathNodes(input({ status: { hotkeyLabel: null } })), false)).toEqual(['broken', 'dead', 'dead', 'dead']);
    expect(pathWires(signalPathNodes(input({ permissions: { ...GRANTED, accessibility: false } })), false)).toEqual(['on', 'on', 'on', 'broken']);
    expect(pathWires(signalPathNodes(input({ permissions: { ...GRANTED, microphone: 'denied' } })), false)).toEqual(['dead', 'dead', 'dead', 'dead']);
  });

  it('stays dark while dictation is paused', () => {
    expect(pathWires(signalPathNodes(input({ status: { paused: true } })), true)).toEqual(['dead', 'dead', 'dead', 'dead']);
    expect(pathWires([], false)).toEqual([]);
  });
});
