import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ServerReconnect } from '../src/main/remote/server-reconnect';
import { SettingsStore } from '../src/main/settings/settings-store';
import { FakePowerEvents } from './fake-power-events';
import { RecordingLogger } from './recording-logger';
import { FlakyKeychain } from './support/flaky-keychain';
import { startTestGateway, type TestGateway } from './support/gateway';
import { createServerService, tinyModels, type ServerServiceHarness } from './support/server-service';

let dir: string;
let gateway: TestGateway;
let settings: SettingsStore;
let keychain: FlakyKeychain;
let power: FakePowerEvents;
const harnesses: ServerServiceHarness[] = [];
const reconnects: ServerReconnect[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-server-unreadable-'));
  gateway = await startTestGateway();
  settings = new SettingsStore(join(dir, 'settings.json'));
  await settings.load();
  keychain = new FlakyKeychain();
  power = new FakePowerEvents();
});

afterEach(async () => {
  reconnects.splice(0).forEach((reconnect) => reconnect.dispose());
  harnesses.splice(0).forEach((harness) => harness.service.dispose());
  await gateway.close();
  await rm(dir, { recursive: true, force: true });
});

async function started(): Promise<ServerServiceHarness> {
  const logger = new RecordingLogger();
  const harness = createServerService({ dir, settings, models: await tinyModels(dir, settings, logger, false), logger, vault: keychain });
  harnesses.push(harness);
  const reconnect = new ServerReconnect({ status: harness.status, check: () => harness.service.check(), power, delaysMs: [50] });
  reconnect.start();
  reconnects.push(reconnect);
  return harness;
}

async function pair(harness: ServerServiceHarness): Promise<void> {
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

describe('a pairing the keychain cannot give back', () => {
  it('keeps retrying when the keychain cannot decrypt the pairing at startup and reconnects once it can', async () => {
    const first = await started();
    await pair(first);
    first.service.dispose();
    keychain.state = 'cannot-decrypt';

    const next = await started();
    await next.service.check();

    expect(next.status.status()).toEqual({ kind: 'unavailable', reason: 'storage' });
    await settle(200);
    expect(next.status.status()).toEqual({ kind: 'unavailable', reason: 'storage' });
    keychain.state = 'available';

    await expect.poll(() => next.status.status().kind, { timeout: 3000 }).toBe('online');
  });

  it('keeps retrying while the keychain is unavailable and reconnects when it is back, without a manual check', async () => {
    const harness = await started();
    await pair(harness);
    keychain.state = 'unavailable';

    power.emit('resume');

    await expect.poll(() => harness.status.status()).toEqual({ kind: 'unavailable', reason: 'storage' });
    await settle(200);
    expect(harness.status.status()).toEqual({ kind: 'unavailable', reason: 'storage' });
    keychain.state = 'available';

    await expect.poll(() => harness.status.status().kind, { timeout: 3000 }).toBe('online');
  });
});
