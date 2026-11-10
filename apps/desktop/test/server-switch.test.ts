import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngineRouting } from '../src/main/engines/engine-routing';
import { writeSettings } from '../src/main/ipc/core-handlers';
import { IpcValidationError } from '../src/main/ipc/validate';
import { ActiveModelReadiness } from '../src/main/models/local-model-readiness';
import type { ServerService } from '../src/main/remote/server-service';
import { SettingsStore } from '../src/main/settings/settings-store';
import { RecordingLogger } from './recording-logger';
import { startTestGateway, type TestGateway } from './support/gateway';
import { createServerService, tinyModels, type ServerServiceHarness } from './support/server-service';

let dir: string;
let gateway: TestGateway;
let settings: SettingsStore;
const services: ServerService[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-server-switch-'));
  gateway = await startTestGateway();
  settings = new SettingsStore(join(dir, 'settings.json'));
  await settings.load();
});

afterEach(async () => {
  for (const service of services.splice(0)) {
    service.dispose();
  }
  await gateway.close();
  await rm(dir, { recursive: true, force: true });
});

type Created = ServerServiceHarness & { statuses: string[]; routing: EngineRouting };

async function create(modelDownloaded = false): Promise<Created> {
  const logger = new RecordingLogger();
  const models = await tinyModels(dir, settings, logger, modelDownloaded);
  const harness = createServerService({ dir, settings, models, logger });
  services.push(harness.service);
  const statuses: string[] = [];
  harness.status.onChange((next) => statuses.push(next.kind));
  const routing = new EngineRouting({ order: harness.order, local: new ActiveModelReadiness(models, settings), server: harness.service });
  return { ...harness, statuses, routing };
}

async function pair(service: ServerService): Promise<string> {
  const window = await gateway.openPairingWindow();
  service.pair(window.token);
  await window.admin.next();
  window.admin.send({ decision: 'approve' });
  const paired = (await window.admin.next()) as { deviceId: string };
  window.admin.close();
  await expect.poll(async () => (await service.view()).server?.status.kind).toBe('online');
  return paired.deviceId;
}

describe('switching the paired server off and on', () => {
  it('keeps the pairing, drops the server from the order and restores the previous order when switched back on', async () => {
    const { service, file } = await create(true);
    await settings.update({ localModelId: 'tiny' });
    await pair(service);
    await settings.update({ engineOrder: ['server', 'local'] });

    await service.setEnabled(false);

    expect(settings.get()).toMatchObject({ engineOrder: ['local'], serverEnabled: false, serverRestoreOrder: ['server', 'local'] });
    expect(await stat(file)).toBeTruthy();
    expect((await service.view()).server).toMatchObject({ enabled: false, status: { kind: 'unknown' } });

    await service.setEnabled(true);

    expect(settings.get()).toMatchObject({ engineOrder: ['server', 'local'], serverEnabled: true, serverRestoreOrder: null });
    await expect.poll(async () => (await service.view()).server).toMatchObject({ enabled: true, status: { kind: 'online' } });
  });

  it('routes to the server when the saved route can no longer transcribe after switching back on', async () => {
    await settings.update({ localModelId: 'tiny' });
    const { service } = await create(true);
    await pair(service);
    expect(settings.get().engineOrder).toEqual(['local']);
    await service.setEnabled(false);
    expect(settings.get()).toMatchObject({ engineOrder: ['local'], serverRestoreOrder: ['local'] });
    await settings.update({ localModelId: null });

    await service.setEnabled(true);

    expect(settings.get()).toMatchObject({ engineOrder: ['server'], serverEnabled: true, serverRestoreOrder: null });
  });

  it('stays switched off after a restart and never contacts the server while off', async () => {
    const first = await create();
    await pair(first.service);
    await first.service.setEnabled(false);
    first.service.dispose();

    settings = new SettingsStore(join(dir, 'settings.json'));
    await settings.load();
    const second = await create();
    second.statuses.splice(0);
    await second.service.check();
    await second.service.refreshOnFocus();

    expect(second.statuses).not.toContain('checking');
    expect(second.statuses).not.toContain('online');
    expect(settings.get()).toMatchObject({ engineOrder: ['local'], serverEnabled: false, serverRestoreOrder: ['server'] });
    expect((await second.service.view()).server).toMatchObject({ enabled: false });
  });

  it('reports a switched off server as paired but unusable and refuses to route to it', async () => {
    const { service, routing } = await create();
    await pair(service);
    await service.setEnabled(false);

    expect(await routing.capabilities()).toEqual({ localReady: false, serverReady: false, serverOffline: false, serverOff: true, serverRepair: false });
    expect(await routing.prefer('server')).toEqual({ kind: 'refused', reason: 'server-not-paired' });
    expect(settings.get().engineOrder).toEqual(['local']);
  });

  it('refuses a settings write that would put the switched off server back into the order', async () => {
    const { service, order } = await create();
    await pair(service);
    await service.setEnabled(false);

    await expect(writeSettings({ settings, order }, { engineOrder: ['local', 'server'] })).rejects.toThrow(IpcValidationError);
    await writeSettings({ settings, order }, { engineOrder: ['local'], mode: 'toggle' });

    expect(settings.get()).toMatchObject({ engineOrder: ['local'], mode: 'toggle', serverEnabled: false });
  });

  it('switches the server back on when a new server is paired and forgets the switch when unpaired', async () => {
    const { service } = await create();
    await pair(service);
    await service.setEnabled(false);

    await pair(service);

    expect(settings.get()).toMatchObject({ engineOrder: ['server'], serverEnabled: true, serverRestoreOrder: null });

    await service.setEnabled(false);
    await service.disconnect();

    expect(settings.get()).toMatchObject({ engineOrder: ['local'], serverEnabled: true, serverRestoreOrder: null });
    expect((await service.view()).server).toBeNull();
  });

  it('ignores the switch while no server is paired', async () => {
    const { service } = await create();

    await service.setEnabled(false);

    expect(settings.get()).toMatchObject({ engineOrder: ['local'], serverEnabled: true, serverRestoreOrder: null });
  });
});
