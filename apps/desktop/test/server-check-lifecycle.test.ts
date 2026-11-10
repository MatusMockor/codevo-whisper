import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReadyConnection } from '../src/main/remote/server-connector';
import { ServerConnector } from '../src/main/remote/server-connector';
import { RemoteEngine } from '../src/main/remote/remote-engine';
import { ServerReconnect } from '../src/main/remote/server-reconnect';
import { SettingsStore } from '../src/main/settings/settings-store';
import { FakePowerEvents } from './fake-power-events';
import { RecordingLogger } from './recording-logger';
import { startDropProxy, type DropProxy } from './support/drop-proxy';
import { freePort, startTestGateway, type TestGateway } from './support/gateway';
import { createServerService, tinyModels, type ServerServiceHarness } from './support/server-service';

const silentObserver = { connected: () => undefined, failed: () => undefined };

let dir: string;
let gateway: TestGateway;
let proxy: DropProxy;
let settings: SettingsStore;
let harness: ServerServiceHarness;
let statuses: string[];
let reconnect: ServerReconnect | null = null;
const held: ReadyConnection[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-server-check-'));
  const proxyPort = await freePort();
  gateway = await startTestGateway({ publicEndpoint: () => `ws://127.0.0.1:${proxyPort}` });
  proxy = await startDropProxy(gateway.port, proxyPort);
  settings = new SettingsStore(join(dir, 'settings.json'));
  await settings.load();
  const logger = new RecordingLogger();
  harness = createServerService({ dir, settings, models: await tinyModels(dir, settings, logger, false), logger, timeoutMs: 400 });
  statuses = [];
  harness.status.onChange((next) => statuses.push(next.kind));
});

afterEach(async () => {
  reconnect?.dispose();
  reconnect = null;
  for (const ready of held.splice(0)) {
    ready.connection.close();
  }
  harness.service.dispose();
  await proxy.close();
  await gateway.close();
  await rm(dir, { recursive: true, force: true });
});

async function pair(): Promise<string> {
  const window = await gateway.openPairingWindow();
  harness.service.pair(window.token);
  await window.admin.next();
  window.admin.send({ decision: 'approve' });
  const paired = (await window.admin.next()) as { deviceId: string };
  window.admin.close();
  await expect.poll(async () => (await harness.service.view()).pairing).toMatchObject({ kind: 'paired', deviceId: paired.deviceId });
  await harness.service.check();
  expect((await harness.service.view()).server).toMatchObject({ deviceId: paired.deviceId, status: { kind: 'online' } });
  return paired.deviceId;
}

async function staleCheck(): Promise<{ pending: Promise<void> }> {
  proxy.blackhole();
  const before = proxy.connections();
  const pending = harness.service.check();
  await expect.poll(() => proxy.connections()).toBe(before + 1);
  expect(harness.status.status()).toEqual({ kind: 'checking' });
  return { pending };
}

describe('server checks across lifecycle changes', () => {
  it('drops a check that is still connecting when the server is switched off and runs a fresh one when it is switched on', async () => {
    reconnect = new ServerReconnect({ status: harness.status, check: () => harness.service.check(), power: new FakePowerEvents(), delaysMs: [50] });
    reconnect.start();
    await pair();
    const stale = await staleCheck();

    await harness.service.setEnabled(false);
    statuses.splice(0);
    await stale.pending;
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(statuses).toEqual([]);
    expect((await harness.service.view()).server).toMatchObject({ enabled: false, status: { kind: 'unknown' } });

    const connections = proxy.connections();
    await harness.service.setEnabled(true);

    expect(proxy.connections()).toBeGreaterThan(connections);
    expect((await harness.service.view()).server).toMatchObject({ enabled: true, status: { kind: 'offline' } });
  });

  it('drops a check that is still connecting when the pairing is removed', async () => {
    await pair();
    const stale = await staleCheck();

    await harness.service.disconnect();
    statuses.splice(0);
    await stale.pending;

    expect(statuses).toEqual([]);
    expect(harness.status.status()).toEqual({ kind: 'unknown' });
  });

  it('stops an old dictation when a new pairing replaces it and never lets it change the new status', async () => {
    const replaced = await pair();
    const preparation = await new RemoteEngine({ connector: harness.connector }).prepare();
    expect(preparation.ready).toBe(true);
    const dictation = preparation.ready ? preparation.engine.start({ language: 'sk', signal: new AbortController().signal }) : null;
    dictation?.push(new Uint8Array(3200));

    const current = await pair();
    expect(current).not.toBe(replaced);
    statuses.splice(0);
    await gateway.admin({ cmd: 'revoke', deviceId: replaced });

    await expect(dictation?.finish()).rejects.toMatchObject({ reason: 'disconnected' });
    expect(statuses).toEqual([]);
    expect((await harness.service.view()).server).toMatchObject({ deviceId: current, status: { kind: 'online' } });
  });

  it('lets a dictation of the current pairing report its failure', async () => {
    const deviceId = await pair();
    const preparation = await new RemoteEngine({ connector: harness.connector }).prepare();
    const dictation = preparation.ready ? preparation.engine.start({ language: 'sk', signal: new AbortController().signal }) : null;
    dictation?.push(new Uint8Array(3200));

    await gateway.admin({ cmd: 'revoke', deviceId });

    await expect(dictation?.finish()).rejects.toMatchObject({ reason: 'repair-needed' });
    expect(harness.status.status()).toEqual({ kind: 'repair-needed', reason: 'device-unknown' });
  });

  it('leaves the checking state when the server is busy and reconnects once a session is free', async () => {
    await pair();
    const holder = new ServerConnector({ pairings: harness.pairings, observer: silentObserver, clock: Date.now, timeoutMs: 2000 });
    for (let index = 0; index < 4; index += 1) {
      held.push(await holder.connect());
    }
    reconnect = new ServerReconnect({ status: harness.status, check: () => harness.service.check(), power: new FakePowerEvents(), delaysMs: [50] });
    reconnect.start();

    await harness.service.check();

    expect(harness.status.status()).toEqual({ kind: 'unavailable', reason: 'busy' });
    expect(statuses.at(-1)).toBe('unavailable');
    expect(harness.service.isOffline()).toBe(true);
    for (const ready of held.splice(0)) {
      ready.connection.close();
    }

    await expect.poll(() => harness.status.status().kind, { timeout: 3000 }).toBe('online');
  });
});
