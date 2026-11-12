import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineDictation, Preparation } from '../src/main/engines/transcription-engine';
import { RemoteEngine } from '../src/main/remote/remote-engine';
import { ServerConnector } from '../src/main/remote/server-connector';
import { SettingsStore } from '../src/main/settings/settings-store';
import { RecordingLogger } from './recording-logger';
import { startDropProxy, type DropProxy } from './support/drop-proxy';
import { freePort, startTestGateway, type TestGateway } from './support/gateway';
import { createServerService, tinyModels, type ServerServiceHarness } from './support/server-service';
import { AutoOnlyServerLanguages } from '../src/main/remote/server-language-support';
import { DEFAULT_SETTINGS as LANGUAGE_DEFAULTS } from '../src/shared/settings';

const AUTO_ONLY = { languages: new AutoOnlyServerLanguages(), selection: () => LANGUAGE_DEFAULTS.languages };

const CHUNK = new Uint8Array(3200);
const QUIET_MS = 600;
const HANDSHAKE_TIMEOUT_MS = 2000;
const PUSHED_WHILE_STALLED = 1000;
const PUSHES_PER_SETTLE = 10;
const STALLED_PUSH_BYTES = 32_000;
const STALLED_TEST_TIMEOUT_MS = 20_000;

let dir: string;
let gateway: TestGateway;
let proxy: DropProxy;
let settings: SettingsStore;
let harness: ServerServiceHarness;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-server-disconnect-'));
  const proxyPort = await freePort();
  gateway = await startTestGateway({ publicEndpoint: () => `ws://127.0.0.1:${proxyPort}`, stt: { respond: () => ({ status: 200, body: { text: 'prisiel neskoro' } }) } });
  proxy = await startDropProxy(gateway.port, proxyPort);
  settings = new SettingsStore(join(dir, 'settings.json'));
  await settings.load();
  const logger = new RecordingLogger();
  harness = createServerService({ dir, settings, models: await tinyModels(dir, settings, logger, false), logger, timeoutMs: HANDSHAKE_TIMEOUT_MS });
});

afterEach(async () => {
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
  return paired.deviceId;
}

function engine(connector: Pick<ServerConnector, 'connect' | 'reconnect'> = harness.connector): RemoteEngine {
  return new RemoteEngine({ connector, ...AUTO_ONLY, options: { reconnectDelaysMs: [50], reconnectWindowMs: 2000 } });
}

function started(preparation: Preparation): EngineDictation {
  expect(preparation.ready).toBe(true);
  const dictation = preparation.ready ? preparation.engine.start({ languages: { mode: 'auto', selected: ['sk'] }, signal: new AbortController().signal }) : null;
  expect(dictation).not.toBeNull();
  return dictation ?? { push: () => undefined, finish: () => Promise.resolve('') };
}

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function activeSessions(): Promise<number> {
  return ((await gateway.admin({ cmd: 'status' })) as { activeSessions: number }).activeSessions;
}

describe('disconnecting the server during remote dictation', () => {
  it('stops an active dictation, sends no more audio and never reconnects', async () => {
    await pair();
    const dictation = started(await engine().prepare());
    dictation.push(CHUNK);
    await expect.poll(activeSessions).toBe(1);

    await harness.service.setEnabled(false);

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'disconnected' });
    await expect.poll(activeSessions).toBe(0);
    const connections = proxy.connections();
    const bytes = proxy.clientBytes();
    dictation.push(CHUNK);
    await settle(QUIET_MS);
    expect(proxy.connections()).toBe(connections);
    expect(proxy.clientBytes()).toBe(bytes);
    expect(gateway.stt.requests).toEqual([]);
  });

  it('does not reconnect or resend the buffered audio when the server is disconnected while the dictation reconnects', async () => {
    await pair();
    const dictation = started(await engine().prepare());
    dictation.push(CHUNK);
    await expect.poll(activeSessions).toBe(1);
    const before = proxy.connections();
    proxy.blackhole();
    proxy.dropAll();
    await expect.poll(() => proxy.connections()).toBe(before + 1);

    await harness.service.setEnabled(false);

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'disconnected' });
    const bytes = proxy.clientBytes();
    await settle(QUIET_MS);
    expect(proxy.connections()).toBe(before + 1);
    expect(proxy.clientBytes()).toBe(bytes);
    expect(gateway.stt.requests).toEqual([]);
  });

  it('never opens a connection that was requested before the server was disconnected', async () => {
    await pair();
    const gate = Promise.withResolvers<void>();
    const connector = new ServerConnector({ pairings: { load: () => gate.promise.then(() => harness.pairings.load()) }, observer: harness.status, scope: () => harness.status.scope(), clock: Date.now, timeoutMs: 400 });
    const preparing = engine(connector).prepare();
    const connections = proxy.connections();

    await harness.service.setEnabled(false);
    gate.resolve();

    expect(await preparing).toEqual({ ready: false, reason: 'server-disconnected' });
    expect(proxy.connections()).toBe(connections);
  });

  it('does not start a dictation on a connection prepared before the server was disconnected', async () => {
    await pair();
    const preparation = await engine().prepare();
    await expect.poll(activeSessions).toBe(1);

    await harness.service.setEnabled(false);
    await expect.poll(activeSessions).toBe(0);
    await settle(100);
    const bytes = proxy.clientBytes();
    const dictation = started(preparation);
    dictation.push(CHUNK);

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'disconnected' });
    await settle(100);
    expect(proxy.clientBytes()).toBe(bytes);
  });

  it('stops a dictation when the server is unpaired', async () => {
    await pair();
    const dictation = started(await engine().prepare());
    dictation.push(CHUNK);
    await expect.poll(activeSessions).toBe(1);

    await harness.service.disconnect();

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'disconnected' });
    await expect.poll(activeSessions).toBe(0);
    expect(gateway.stt.requests).toEqual([]);
  });

  it('ignores a final transcript that arrives after the server was disconnected', async () => {
    await pair();
    const updates: string[] = [];
    const preparation = await engine().prepare();
    const dictation = preparation.ready ? preparation.engine.start({ languages: { mode: 'auto', selected: ['sk'] }, signal: new AbortController().signal, onTranscript: (update) => updates.push(update.type) }) : null;
    expect(dictation).not.toBeNull();
    dictation?.push(new Uint8Array(32_000));
    proxy.holdRepliesAfter(0);
    const result = dictation?.finish();
    await expect.poll(() => proxy.heldReplies(), { timeout: 3000 }).toBeGreaterThan(0);

    await harness.service.setEnabled(false);
    proxy.releaseReplies();

    await expect(result).rejects.toMatchObject({ reason: 'disconnected' });
    await settle(200);
    expect(updates).toEqual([]);
  });

  it('discards the audio still queued for a stalled connection instead of draining it after the disconnect', async () => {
    await pair();
    const dictation = started(await engine().prepare());
    dictation.push(CHUNK);
    await expect.poll(activeSessions).toBe(1);
    proxy.stallClients();
    const stalledAt = proxy.clientBytes();
    for (let index = 0; index < PUSHED_WHILE_STALLED; index += 1) {
      dictation.push(new Uint8Array(STALLED_PUSH_BYTES));
      if (index % PUSHES_PER_SETTLE !== 0) {
        continue;
      }
      await settle(2);
    }
    await settle(200);

    await harness.service.setEnabled(false);
    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'disconnected' });
    proxy.resumeClients();
    await settle(QUIET_MS);

    expect(proxy.clientBytes() - stalledAt).toBeLessThan((PUSHED_WHILE_STALLED * STALLED_PUSH_BYTES) / 2);
    expect(gateway.stt.requests).toEqual([]);
    await expect.poll(activeSessions).toBe(0);
  }, STALLED_TEST_TIMEOUT_MS);
});

describe('disconnecting the server while a connection is being opened', () => {
  for (const [stage, passed] of [['WebSocket upgrade', 0], ['secure handshake', 1]] as const) {
    it(`cancels the ${stage} at once and reports a disconnect even when the server rejects the device`, async () => {
      const deviceId = await pair();
      await gateway.admin({ cmd: 'revoke', deviceId });
      proxy.holdRepliesAfter(passed);
      const preparing = engine().prepare();
      await expect.poll(() => proxy.heldReplies()).toBeGreaterThan(0);

      const disconnectedAt = Date.now();
      await harness.service.setEnabled(false);
      proxy.releaseReplies();

      expect(await preparing).toEqual({ ready: false, reason: 'server-disconnected' });
      expect(Date.now() - disconnectedAt).toBeLessThan(HANDSHAKE_TIMEOUT_MS / 2);
      expect(harness.status.status().kind).not.toBe('repair-needed');
    });
  }

  it('cancels a connection that waits for the server to accept the session', async () => {
    await pair();
    proxy.holdRepliesAfter(2);
    const preparing = engine().prepare();
    await expect.poll(() => proxy.heldReplies()).toBeGreaterThan(0);

    const disconnectedAt = Date.now();
    await harness.service.setEnabled(false);
    proxy.releaseReplies();

    expect(await preparing).toEqual({ ready: false, reason: 'server-disconnected' });
    expect(Date.now() - disconnectedAt).toBeLessThan(HANDSHAKE_TIMEOUT_MS / 2);
  });

  it('reports a disconnect when the server is disconnected right as the connection becomes ready', async () => {
    await pair();
    const stop = harness.status.onChange((status) => {
      if (status.kind !== 'online') {
        return;
      }
      stop();
      harness.status.invalidate();
    });

    expect(await engine().prepare()).toEqual({ ready: false, reason: 'server-disconnected' });
    await expect.poll(activeSessions).toBe(0);
  });
});
