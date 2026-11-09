import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngineRouting } from '../src/main/engines/engine-routing';
import { ActiveModelReadiness } from '../src/main/models/local-model-readiness';
import type { PairingRepository } from '../src/main/remote/pairing-repository';
import type { VaultAvailability } from '../src/main/remote/secret-vault';
import type { ServerService } from '../src/main/remote/server-service';
import { SettingsStore } from '../src/main/settings/settings-store';
import type { ServerView } from '../src/shared/server';
import { RecordingLogger } from './recording-logger';
import { startTestGateway, type TestGateway } from './support/gateway';
import { createServerService, tinyModels } from './support/server-service';

let dir: string;
let gateway: TestGateway;
let settings: SettingsStore;
let service: ServerService | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-server-service-'));
  gateway = await startTestGateway();
  settings = new SettingsStore(join(dir, 'settings.json'));
  await settings.load();
});

afterEach(async () => {
  service?.dispose();
  service = null;
  await gateway.close();
  await rm(dir, { recursive: true, force: true });
});

let now = Date.parse('2026-10-26T10:00:00.000Z');

type Setup = { availability?: VaultAvailability; modelDownloaded?: boolean; wrapPairings?: (pairings: PairingRepository) => PairingRepository };

type Created = { service: ServerService; views: ServerView[]; file: string; statuses: string[]; routing: EngineRouting };

async function create(setup: Setup = {}): Promise<Created> {
  const logger = new RecordingLogger();
  const models = await tinyModels(dir, settings, logger, setup.modelDownloaded ?? false);
  const wrap = setup.wrapPairings === undefined ? {} : { wrapPairings: setup.wrapPairings };
  const harness = createServerService({ dir, settings, models, logger, availability: setup.availability ?? 'available', clock: () => now, ...wrap });
  service = harness.service;
  const views: ServerView[] = [];
  const statuses: string[] = [];
  harness.status.onChange((next) => statuses.push(next.kind));
  service.onChange((view) => views.push(view));
  const routing = new EngineRouting({ order: harness.order, local: new ActiveModelReadiness(models, settings), server: service });
  return { service, views, file: harness.file, statuses, routing };
}

function fileState(file: string): Promise<'present' | 'absent'> {
  return stat(file).then(
    () => 'present',
    () => 'absent',
  );
}

type SaveGate = { saving: Promise<void>; saved: Promise<void>; release: () => void; wrap: (pairings: PairingRepository) => PairingRepository };

function saveGate(): SaveGate {
  const saving = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const saved = Promise.withResolvers<void>();
  return {
    saving: saving.promise,
    saved: saved.promise,
    release: () => released.resolve(),
    wrap: (pairings) => ({
      load: () => pairings.load(),
      clear: () => pairings.clear(),
      save: async (pairing) => {
        saving.resolve();
        await released.promise;
        await pairings.save(pairing);
        saved.resolve();
      },
    }),
  };
}

async function pairThroughService(target: ServerService): Promise<string> {
  const window = await gateway.openPairingWindow();
  target.pair(window.token);
  await window.admin.next();
  window.admin.send({ decision: 'approve' });
  const paired = (await window.admin.next()) as { deviceId: string };
  window.admin.close();
  await expect.poll(async () => (await target.view()).server?.status.kind).toBe('online');
  return paired.deviceId;
}

describe('ServerService', () => {
  it('walks through pairing and then reports the server online', async () => {
    const { service: target, views } = await create();
    expect(await target.view()).toEqual({ storage: 'available', server: null, pairing: { kind: 'idle' } });

    const deviceId = await pairThroughService(target);

    const kinds = views.map((view) => view.pairing.kind).filter((kind, index, all) => kind !== all[index - 1]);
    expect(kinds).toEqual(['connecting', 'awaiting-approval', 'paired']);
    const view = await target.view();
    expect(view.pairing).toEqual({ kind: 'paired', deviceId, engine: { kind: 'switched', previous: ['local'], current: ['server'] } });
    expect(view.server).toMatchObject({ host: `127.0.0.1:${gateway.port}`, endpoint: gateway.url, deviceId, deviceName: 'Test Mac', status: { kind: 'online' } });
    expect(view.server?.serverFingerprint).toMatch(/^([0-9A-F]{4} ){7}[0-9A-F]{4}$/);
  });

  it('switches transcription to the server after pairing when no local model is downloaded', async () => {
    await settings.update({ engineOrder: ['local', 'server'] });
    const { service: target } = await create();

    await pairThroughService(target);

    expect(settings.get().engineOrder).toEqual(['server']);
    expect((await target.view()).pairing).toMatchObject({ kind: 'paired', engine: { kind: 'switched', previous: ['local', 'server'], current: ['server'] } });
  });

  it('only offers the server after pairing when the local model is ready', async () => {
    await settings.update({ localModelId: 'tiny' });
    const { service: target } = await create({ modelDownloaded: true });

    await pairThroughService(target);

    expect(settings.get().engineOrder).toEqual(['local']);
    expect((await target.view()).pairing).toMatchObject({ kind: 'paired', engine: { kind: 'available' } });
  });

  it('keeps a server-first order untouched after pairing', async () => {
    await settings.update({ engineOrder: ['server', 'local'] });
    const { service: target } = await create();

    await pairThroughService(target);

    expect(settings.get().engineOrder).toEqual(['server', 'local']);
    expect((await target.view()).pairing).toMatchObject({ kind: 'paired', engine: { kind: 'unchanged' } });
  });

  it('reports offline when the gateway stops and repair-needed after a revoke', async () => {
    const { service: target } = await create();
    const deviceId = await pairThroughService(target);

    await gateway.stop();
    await target.check();
    expect((await target.view()).server?.status).toEqual({ kind: 'offline' });

    await gateway.restart();
    await gateway.admin({ cmd: 'revoke', deviceId });
    await target.check();
    expect((await target.view()).server?.status).toEqual({ kind: 'repair-needed', reason: 'device-unknown' });
  });

  it('disconnects only locally, gives the revoke command and switches the engine back to local', async () => {
    const { service: target, file } = await create();
    const deviceId = await pairThroughService(target);
    await settings.update({ engineOrder: ['server', 'local'] });

    const result = await target.disconnect();

    expect(result).toEqual({ revokeCommand: `docker compose -f infrastructure/compose/compose.yaml exec gateway codevo-whisper revoke ${deviceId}` });
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(settings.get().engineOrder).toEqual(['local']);
    expect(await target.view()).toEqual({ storage: 'available', server: null, pairing: { kind: 'idle' } });
    expect(await gateway.admin({ cmd: 'devices' })).toMatchObject({ devices: [{ id: deviceId }] });
  });

  it('reports a pairing failure and an insecure key store', async () => {
    const insecure = await create({ availability: 'insecure' });
    insecure.service.pair('cw1:not-a-token');
    await expect.poll(async () => (await insecure.service.view()).pairing).toEqual({ kind: 'failed', failure: 'invalid-token' });
    expect((await insecure.service.view()).storage).toBe('insecure');
    insecure.service.dispose();

    const window = await gateway.openPairingWindow();
    const blocked = await create({ availability: 'insecure' });
    blocked.service.pair(window.token);
    await expect.poll(async () => (await blocked.service.view()).pairing).toEqual({ kind: 'failed', failure: 'storage-insecure' });
    window.admin.close();
  });

  it('cancels a pairing that waits for the approval', async () => {
    const { service: target } = await create();
    const window = await gateway.openPairingWindow();
    target.pair(window.token);
    await window.admin.next();

    target.cancelPairing();

    await expect.poll(async () => (await target.view()).pairing).toEqual({ kind: 'failed', failure: 'cancelled' });
    window.admin.close();
  });

  it('a cancel while the approved pairing is being saved reports the cancel, keeps the engine and leaves nothing paired', async () => {
    const gate = saveGate();
    const { service: target, file } = await create({ wrapPairings: gate.wrap });
    const window = await gateway.openPairingWindow();
    target.pair(window.token);
    await window.admin.next();
    window.admin.send({ decision: 'approve' });
    await gate.saving;

    target.cancelPairing();
    gate.release();
    await gate.saved;

    await expect.poll(() => fileState(file)).toBe('absent');
    expect(settings.get().engineOrder).toEqual(['local']);
    expect(await target.view()).toEqual({ storage: 'available', server: null, pairing: { kind: 'failed', failure: 'cancelled' } });
    window.admin.close();
  });

  it('a disconnect never leaves the server as the only engine while a switch to it is still being saved', async () => {
    const { service: target, routing } = await create();
    await pairThroughService(target);
    await settings.update({ engineOrder: ['local'] });

    const switching = routing.prefer('server');
    await target.disconnect();
    await switching;

    expect(settings.get().engineOrder).toEqual(['local']);
    expect(await target.view()).toEqual({ storage: 'available', server: null, pairing: { kind: 'idle' } });
  });

  it('a disconnect during a pending pairing leaves nothing paired', async () => {
    const { service: target, file } = await create();
    const window = await gateway.openPairingWindow();
    target.pair(window.token);
    await window.admin.next();

    window.admin.send({ decision: 'approve' });
    await target.disconnect();
    await window.admin.next();
    window.admin.close();
    await new Promise((resolve) => setTimeout(resolve, 100));

    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await target.view()).toEqual({ storage: 'available', server: null, pairing: { kind: 'idle' } });
    expect(settings.get().engineOrder).toEqual(['local']);
  });

  it('runs one check at a time and checks on focus at most every 15 seconds', async () => {
    const { service: target, statuses } = await create();
    await pairThroughService(target);
    statuses.splice(0);

    await Promise.all([target.check(), target.check()]);
    expect(statuses).toEqual(['checking', 'online']);

    statuses.splice(0);
    now += 1000;
    await target.refreshOnFocus();
    now += 14_000;
    await target.refreshOnFocus();
    expect(statuses).toEqual([]);

    now += 1000;
    await target.refreshOnFocus();
    expect(statuses).toEqual(['checking', 'online']);
  });

  it('keeps the re-pair state while it checks the server again', async () => {
    const { service: target, statuses } = await create();
    const deviceId = await pairThroughService(target);
    await gateway.admin({ cmd: 'revoke', deviceId });
    await target.check();
    expect(target.needsRepair()).toBe(true);
    const repairWhileChecking: boolean[] = [];
    target.onChange(() => repairWhileChecking.push(target.needsRepair()));
    statuses.splice(0);

    await target.check();

    expect(statuses).not.toContain('checking');
    expect(repairWhileChecking.every(Boolean)).toBe(true);
    expect((await target.view()).server?.status).toEqual({ kind: 'repair-needed', reason: 'device-unknown' });
  });
});
