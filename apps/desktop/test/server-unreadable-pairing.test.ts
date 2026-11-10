import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PairingRepository } from '../src/main/remote/pairing-repository';
import { RemoteFailure } from '../src/main/remote/remote-failure';
import { ServerReconnect } from '../src/main/remote/server-reconnect';
import { SettingsStore } from '../src/main/settings/settings-store';
import { FakePowerEvents } from './fake-power-events';
import { RecordingLogger } from './recording-logger';
import { startTestGateway, type TestGateway } from './support/gateway';
import { createServerService, tinyModels, type ServerServiceHarness } from './support/server-service';

let dir: string;
let gateway: TestGateway;
let settings: SettingsStore;
let harness: ServerServiceHarness;
let reconnect: ServerReconnect | null = null;
let unreadable = false;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-server-unreadable-'));
  gateway = await startTestGateway();
  settings = new SettingsStore(join(dir, 'settings.json'));
  await settings.load();
  unreadable = false;
  const logger = new RecordingLogger();
  const wrapPairings = (pairings: PairingRepository): PairingRepository => ({
    load: () => (unreadable ? Promise.reject(new RemoteFailure('storage-insecure', 'the key store is locked')) : pairings.load()),
    save: (pairing) => pairings.save(pairing),
    clear: () => pairings.clear(),
    clearDevice: (deviceId) => pairings.clearDevice(deviceId),
  });
  harness = createServerService({ dir, settings, models: await tinyModels(dir, settings, logger, false), logger, wrapPairings });
});

afterEach(async () => {
  reconnect?.dispose();
  reconnect = null;
  harness.service.dispose();
  await gateway.close();
  await rm(dir, { recursive: true, force: true });
});

async function pair(): Promise<void> {
  const window = await gateway.openPairingWindow();
  harness.service.pair(window.token);
  await window.admin.next();
  window.admin.send({ decision: 'approve' });
  const paired = (await window.admin.next()) as { deviceId: string };
  window.admin.close();
  await expect.poll(async () => (await harness.service.view()).pairing).toMatchObject({ kind: 'paired', deviceId: paired.deviceId });
  await harness.service.check();
}

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('a pairing that cannot be read', () => {
  it('keeps retrying instead of treating the server as unpaired and reconnects once the key store is back', async () => {
    await pair();
    reconnect = new ServerReconnect({ status: harness.status, check: () => harness.service.check(), power: new FakePowerEvents(), delaysMs: [50] });
    reconnect.start();
    unreadable = true;

    await harness.service.check();

    expect(harness.status.status()).toEqual({ kind: 'unavailable', reason: 'storage' });
    await settle(200);
    expect(harness.status.status()).toEqual({ kind: 'unavailable', reason: 'storage' });
    unreadable = false;

    await expect.poll(() => harness.status.status().kind, { timeout: 3000 }).toBe('online');
  });
});
