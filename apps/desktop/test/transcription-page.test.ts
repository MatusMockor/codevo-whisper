import { describe, expect, it } from 'vitest';
import { engineConditions } from '../src/renderer/settings/engine-conditions';
import { activeDownload, engineCard, type EngineFacts } from '../src/renderer/transcription/engine-cards';
import { nowState } from '../src/renderer/transcription/now-state';
import { PAUSED_NOTE, readinessNote } from '../src/renderer/transcription/readiness-note';
import { readinessSummary } from '../src/renderer/home/readiness';
import type { AppStatus } from '../src/shared/app-status';
import { droppedOrder, routeText, swapped, withFallback, withoutFallback } from '../src/renderer/transcription/route-order';
import type { EngineConditions } from '../src/shared/engine-routing';
import type { ModelState } from '../src/shared/models';
import type { PairedServerView, ServerStatus } from '../src/shared/server';
import type { EngineId } from '../src/shared/settings';

const ONLINE: ServerStatus = { kind: 'online', connectMs: 38, serverVersion: '0.4.1', languages: { kind: 'reported', languages: ['sk'], models: { transcription: 'Parakeet', conditioned: 'Canary', languageId: 'VoxLingua107' } } };

function server(status: ServerStatus, enabled = true): PairedServerView {
  return { host: '127.0.0.1:8787', endpoint: 'ws://127.0.0.1:8787', deviceId: 'dev', deviceName: 'Mac', pairedAt: '2026-11-01', serverFingerprint: 'a', deviceFingerprint: 'b', status, enabled };
}

const READY_STATE: ModelState = { id: 'tiny', status: 'ready', receivedBytes: 1, totalBytes: 1 };

function conditionsFor(paired: PairedServerView | null, localReady: boolean): EngineConditions {
  const states = localReady ? [READY_STATE] : [];
  const conditions = engineConditions('tiny', { states, statesLoaded: true }, { storage: 'available', server: paired, pairing: { kind: 'idle' } });
  expect(conditions).not.toBeNull();
  return conditions ?? { localReady: false, serverReady: false, serverOffline: false, serverOff: false, serverRepair: false };
}

function facts(paired: PairedServerView | null, localReady: boolean, download: ModelState | null = null): EngineFacts {
  return { server: paired, local: { modelName: localReady ? 'Parakeet' : null, download }, conditions: conditionsFor(paired, localReady) };
}

function now(order: EngineId[], engineFacts: EngineFacts) {
  return nowState(order, engineFacts);
}

describe('Prepis current state', () => {
  it('names the engine that transcribes and its fallback', () => {
    expect(now(['server', 'local'], facts(server(ONLINE), true))).toEqual({
      tone: 'ok',
      title: 'Prepisuje sa na: Server 127.0.0.1:8787',
      detail: 'Záloha: lokálny prepis, Parakeet.',
      remedy: null,
    });
    expect(now(['local'], facts(null, true))).toMatchObject({ tone: 'ok', title: 'Prepisuje sa na: Lokálne', detail: 'Bez zálohy.' });
    expect(now(['local', 'server'], facts(server({ kind: 'offline' }), true))).toMatchObject({ tone: 'ok', detail: 'Záloha (server 127.0.0.1:8787) teraz nie je pripravená: neodpovedá.' });
  });

  it('treats a busy or failing server like an unreachable one, as the engine selector does', () => {
    const busy = server({ kind: 'unavailable', reason: 'busy' });
    expect(conditionsFor(busy, true)).toMatchObject({ serverReady: true, serverOffline: true });
    expect(now(['server', 'local'], facts(busy, true))).toMatchObject({ tone: 'warn', title: 'Prepisuje sa na: Lokálne' });
    expect(now(['server'], facts(busy, false))).toEqual({
      tone: 'err',
      title: 'Server je zaneprázdnený',
      detail: 'Server teraz nemôže prepisovať a iný prepis nie je pripravený. Aplikácia to skúša znova sama.',
      remedy: null,
    });
    expect(now(['server'], facts(server({ kind: 'unavailable', reason: 'failed' }), true))).toMatchObject({ tone: 'err', title: 'Server odpovedá chybou', remedy: { action: 'use-local' } });
  });

  it('warns when the fallback carries every dictation', () => {
    expect(now(['server', 'local'], facts(server({ kind: 'offline' }), true))).toEqual({
      tone: 'warn',
      title: 'Prepisuje sa na: Lokálne',
      detail: 'Server 127.0.0.1:8787 teraz nie je pripravený (neodpovedá), diktovanie preto ide na zálohu.',
      remedy: null,
    });
  });

  it('explains a broken route and offers the shared one-click fix', () => {
    expect(now(['local'], facts(server(ONLINE), false))).toMatchObject({ tone: 'err', title: 'Lokálny model chýba', remedy: { action: 'use-server', alternative: 'download-model' } });
    expect(now(['local'], facts(server(ONLINE, false), false))).toEqual({
      tone: 'err',
      title: 'Lokálny model chýba',
      detail: 'Prepis je nastavený na lokálny model, ten nie je stiahnutý a server je odpojený.',
      remedy: { action: 'download-model', alternative: 'enable-server' },
    });
    expect(now(['server'], facts(server({ kind: 'offline' }), false))).toEqual({
      tone: 'err',
      title: 'Server neodpovedá',
      detail: 'Server na adrese ws://127.0.0.1:8787 neodpovedá a iný prepis nie je pripravený.',
      remedy: null,
    });
    expect(now(['server'], facts(server({ kind: 'repair-needed', reason: 'device-unknown' }), true))).toMatchObject({ title: 'Server treba znova spárovať', remedy: { action: 'use-local', alternative: 'pair-server' } });
    expect(now(['server', 'local'], facts(server({ kind: 'repair-needed', reason: 'server-key-changed' }), true))).toEqual({
      tone: 'err',
      title: 'Server treba znova spárovať',
      detail: 'Kým server znova nespárujete, Codevo Whisper naň neposiela zvuk a z bezpečnostných dôvodov neprejde ani na zálohu.',
      remedy: { action: 'use-local', alternative: 'pair-server' },
    });
    expect(now(['local'], facts(null, false, { id: 'tiny', status: 'downloading', receivedBytes: 1, totalBytes: 4 }))).toMatchObject({ detail: 'Model sa sťahuje. Diktovanie začne fungovať, keď bude pripravený.' });
  });
});

describe('Prepis engine cards', () => {
  it('describes each server state without placeholder values', () => {
    expect(engineCard('server', facts(server(ONLINE), false))).toMatchObject({ meta: '38 ms · šifrované E2E', ready: true });
    expect(engineCard('server', facts(server({ kind: 'offline' }), false))).toMatchObject({ meta: 'neodpovedá', ready: false });
    expect(engineCard('server', facts(server(ONLINE, false), false))).toMatchObject({ meta: 'odpojený', ready: false });
    expect(engineCard('server', facts(null, false))).toMatchObject({ title: 'Server', meta: 'nie je spárovaný', ready: false });
    expect(engineCard('server', facts(server({ kind: 'unavailable', reason: 'busy' }), false))).toMatchObject({ meta: 'zaneprázdnený', ready: false });
    expect(engineCard('server', facts(server({ kind: 'unavailable', reason: 'failed' }), false))).toMatchObject({ meta: 'odpovedá chybou', ready: false });
    expect(engineCard('server', facts(server({ kind: 'repair-needed', reason: 'device-unknown' }), true))).toMatchObject({ meta: 'treba znova spárovať', ready: false });
    expect(engineCard('local', facts(null, false, { id: 'tiny', status: 'downloading', receivedBytes: 1, totalBytes: 4 }))).toMatchObject({ meta: 'model sa sťahuje · 25 %' });
  });

  it('finds the model that is downloading right now', () => {
    expect(activeDownload([READY_STATE, { id: 'big', status: 'downloading', receivedBytes: 0, totalBytes: 0 }])?.id).toBe('big');
    expect(activeDownload([READY_STATE])).toBeNull();
  });
});

describe('Prepis route editing', () => {
  it('swaps, adds and removes the fallback', () => {
    expect(swapped(['server', 'local'])).toEqual(['local', 'server']);
    expect(swapped(['local'])).toEqual(['local']);
    expect(withFallback(['local'])).toEqual(['local', 'server']);
    expect(withFallback(['server'])).toEqual(['server', 'local']);
    expect(withoutFallback(['server', 'local'])).toEqual(['server']);
  });

  it('moves a dragged engine into a slot and never adds a server that cannot be used', () => {
    expect(droppedOrder(['server', 'local'], 'local', 0, true)).toEqual(['local', 'server']);
    expect(droppedOrder(['local'], 'local', 1, true)).toEqual(['server', 'local']);
    expect(droppedOrder(['local'], 'local', 1, false)).toBeNull();
    expect(droppedOrder(['local'], 'local', 0, true)).toBeNull();
    expect(droppedOrder(['server'], 'server', 1, false)).toEqual(['local', 'server']);
  });

  it('explains every route', () => {
    expect(routeText(['server', 'local'])).toEqual({ title: 'Server, potom lokálne', detail: 'Keď server pri začatí diktovania nie je dostupný, prepíše sa lokálne.' });
    expect(routeText(['local']).title).toBe('Lokálne');
  });
});

describe('Prepis readiness note', () => {
  const READY: AppStatus = { hotkeyLabel: '⌥Space', mode: 'smart', modelReady: true, pairingNeeded: false, serverRepairNeeded: false, permissionsOk: true, paused: false };

  it('says why dictation fails although the transcription route works, so it matches the status bar', () => {
    const note = readinessNote({ ...READY, hotkeyLabel: null }, null, 'ok');
    expect(note?.message).toBe('Prepis je pripravený, diktovanie však zatiaľ nefunguje. Nastavte klávesovú skratku, ktorou budete diktovať.');
    expect(note?.content?.target).toEqual({ page: 'settings', section: 'dictation' });
    expect(readinessSummary({ ...READY, hotkeyLabel: null }, null).label).toBe('Diktovanie nefunguje');
    expect(readinessNote({ ...READY, permissionsOk: false }, null, 'warn')?.content?.target).toEqual({ page: 'settings' });
    expect(readinessNote({ ...READY, paused: true }, null, 'ok')).toEqual({ message: PAUSED_NOTE, content: null });
  });

  it('stays quiet when the route itself is the problem or everything is ready', () => {
    expect(readinessNote(READY, null, 'ok')).toBeNull();
    expect(readinessNote({ ...READY, hotkeyLabel: null }, null, 'err')).toBeNull();
    expect(readinessNote({ ...READY, serverRepairNeeded: true }, null, 'ok')).toBeNull();
    expect(readinessNote(null, null, 'ok')).toBeNull();
  });
});
