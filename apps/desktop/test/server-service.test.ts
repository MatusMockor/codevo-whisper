import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DevicePairing } from '../src/main/remote/device-pairing';
import { InsecureTestVault } from '../src/main/remote/insecure-test-vault';
import { EncryptedPairingFile } from '../src/main/remote/pairing-repository';
import type { VaultAvailability } from '../src/main/remote/secret-vault';
import { ServerConnector } from '../src/main/remote/server-connector';
import { ServerService } from '../src/main/remote/server-service';
import { ServerStatusBoard } from '../src/main/remote/server-status';
import { SettingsStore } from '../src/main/settings/settings-store';
import type { ServerView } from '../src/shared/server';
import { RecordingLogger } from './recording-logger';
import { startTestGateway, type TestGateway } from './support/gateway';

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

function create(availability: VaultAvailability = 'available'): { service: ServerService; views: ServerView[]; file: string; statuses: string[] } {
  const logger = new RecordingLogger();
  const vault = new InsecureTestVault(availability);
  const file = join(dir, 'server-pairing.json');
  const pairings = new EncryptedPairingFile(file, vault, logger);
  const status = new ServerStatusBoard(logger);
  const connector = new ServerConnector({ pairings, observer: status, clock: Date.now, timeoutMs: 2000 });
  const pairing = new DevicePairing({ pairings, vault, deviceName: () => Promise.resolve('Test Mac'), clock: Date.now, timeoutMs: 2000 });
  service = new ServerService({ pairings, vault, connector, status, pairing, settings, logger, clock: () => now });
  const views: ServerView[] = [];
  const statuses: string[] = [];
  status.onChange((next) => statuses.push(next.kind));
  service.onChange((view) => views.push(view));
  return { service, views, file, statuses };
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
    const { service: target, views } = create();
    expect(await target.view()).toEqual({ storage: 'available', server: null, pairing: { kind: 'idle' } });

    const deviceId = await pairThroughService(target);

    const kinds = views.map((view) => view.pairing.kind).filter((kind, index, all) => kind !== all[index - 1]);
    expect(kinds).toEqual(['connecting', 'awaiting-approval', 'paired']);
    const view = await target.view();
    expect(view.pairing).toEqual({ kind: 'paired', deviceId });
    expect(view.server).toMatchObject({ host: `127.0.0.1:${gateway.port}`, endpoint: gateway.url, deviceId, deviceName: 'Test Mac', status: { kind: 'online' } });
    expect(view.server?.serverFingerprint).toMatch(/^([0-9A-F]{4} ){7}[0-9A-F]{4}$/);
  });

  it('reports offline when the gateway stops and repair-needed after a revoke', async () => {
    const { service: target } = create();
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
    const { service: target, file } = create();
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
    const insecure = create('insecure');
    insecure.service.pair('cw1:not-a-token');
    await expect.poll(async () => (await insecure.service.view()).pairing).toEqual({ kind: 'failed', failure: 'invalid-token' });
    expect((await insecure.service.view()).storage).toBe('insecure');
    insecure.service.dispose();

    const window = await gateway.openPairingWindow();
    const blocked = create('insecure');
    blocked.service.pair(window.token);
    await expect.poll(async () => (await blocked.service.view()).pairing).toEqual({ kind: 'failed', failure: 'storage-insecure' });
    window.admin.close();
  });

  it('cancels a pairing that waits for the approval', async () => {
    const { service: target } = create();
    const window = await gateway.openPairingWindow();
    target.pair(window.token);
    await window.admin.next();

    target.cancelPairing();

    await expect.poll(async () => (await target.view()).pairing).toEqual({ kind: 'failed', failure: 'cancelled' });
    window.admin.close();
  });

  it('a disconnect during a pending pairing leaves nothing paired', async () => {
    const { service: target, file } = create();
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
  });

  it('runs one check at a time and checks on focus at most every 15 seconds', async () => {
    const { service: target, statuses } = create();
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
});
