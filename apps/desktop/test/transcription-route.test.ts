import { describe, expect, it } from 'vitest';
import { transcriptionRoute, type RouteInput } from '../src/renderer/home/transcription-route';
import type { AppStatus } from '../src/shared/app-status';
import type { PairedServerView, ServerStatus } from '../src/shared/server';

const READY: AppStatus = { hotkeyLabel: '⌥Space', mode: 'smart', modelReady: true, pairingNeeded: false, serverRepairNeeded: false, permissionsOk: true, paused: false };

function server(status: ServerStatus): PairedServerView {
  return { host: 'domáci-pc', endpoint: 'wss://domaci-pc:8443', deviceId: 'dev', deviceName: 'MacBook', pairedAt: '2026-11-01', serverFingerprint: 'a', deviceFingerprint: 'b', status };
}

const ONLINE = server({ kind: 'online', connectMs: 38, serverVersion: '0.2.4' });

function input(patch: Partial<RouteInput> = {}): RouteInput {
  return { status: READY, engineOrder: ['local'], server: null, localReady: true, modelName: 'Parakeet TDT', ...patch };
}

describe('transcriptionRoute', () => {
  it('describes local transcription with its model and fallback', () => {
    expect(transcriptionRoute(input())).toEqual({ state: 'ok', label: 'Lokálne · Parakeet TDT', detail: 'na tomto zariadení', latencyMs: null, target: { page: 'settings', section: 'Kde beží prepis' } });
    expect(transcriptionRoute(input({ engineOrder: ['local', 'server'], server: ONLINE }))).toMatchObject({ state: 'ok', detail: 'záloha: server' });
    expect(transcriptionRoute(input({ modelName: null }))).toMatchObject({ label: 'Lokálne' });
  });

  it('describes the paired server with its latency', () => {
    expect(transcriptionRoute(input({ engineOrder: ['server'], server: ONLINE, localReady: false }))).toEqual({
      state: 'ok',
      label: 'Server domáci-pc',
      detail: '38 ms · E2E',
      latencyMs: 38,
      target: { page: 'settings', section: 'Kde beží prepis' },
    });
    expect(transcriptionRoute(input({ engineOrder: ['server'], server: server({ kind: 'unknown' }) }))).toMatchObject({ state: 'ok', detail: 'šifrované E2E', latencyMs: null });
  });

  it('warns when a fallback is carrying the dictation', () => {
    expect(transcriptionRoute(input({ engineOrder: ['server', 'local'] }))).toMatchObject({ state: 'warn', label: 'Lokálne · Parakeet TDT', detail: 'server nie je spárovaný', target: { page: 'server' } });
    expect(transcriptionRoute(input({ engineOrder: ['server', 'local'], server: server({ kind: 'offline' }) }))).toMatchObject({ state: 'warn', detail: 'offline · záloha lokálne' });
    expect(transcriptionRoute(input({ engineOrder: ['server'], server: server({ kind: 'offline' }), localReady: false }))).toMatchObject({ state: 'warn', detail: 'server je offline' });
    expect(transcriptionRoute(input({ engineOrder: ['local', 'server'], server: ONLINE, localReady: false }))).toMatchObject({
      state: 'warn',
      label: 'Server domáci-pc',
      latencyMs: 38,
      target: { page: 'settings', section: 'Lokálny model' },
    });
  });

  it('points at the fix when dictation would fail', () => {
    expect(transcriptionRoute(input({ status: { ...READY, serverRepairNeeded: true } }))).toEqual({ state: 'err', label: 'Server treba znova spárovať', detail: 'kliknite a opravte', latencyMs: null, target: { page: 'server' } });
    expect(transcriptionRoute(input({ status: { ...READY, modelReady: false, pairingNeeded: true } }))).toMatchObject({ state: 'err', label: 'Server nie je spárovaný', target: { page: 'server' } });
    expect(transcriptionRoute(input({ status: { ...READY, modelReady: false }, localReady: false }))).toMatchObject({ state: 'err', label: 'Lokálne · model chýba', target: { page: 'settings', section: 'Lokálny model' } });
  });
});
