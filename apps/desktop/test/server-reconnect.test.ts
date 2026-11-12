import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UNKNOWN_MODELS } from '@codevo-whisper/protocol';
import type { Preparation } from '../src/main/engines/transcription-engine';
import { RemoteEngine } from '../src/main/remote/remote-engine';
import { ServerLanguageGate } from '../src/main/remote/server-language-support';
import { ServerReconnect } from '../src/main/remote/server-reconnect';
import type { LanguageSelection } from '../src/shared/dictation-languages';
import type { ServerStatus } from '../src/shared/server';
import { ROUTING_MODELS, ROUTING_STT } from '../../server/test/support/fake-stt-server';
import type { ServerService } from '../src/main/remote/server-service';
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
let statuses: string[];
let power: FakePowerEvents;

const DELAYS_MS = [40, 80];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-server-reconnect-'));
  gateway = await startTestGateway();
  settings = new SettingsStore(join(dir, 'settings.json'));
  await settings.load();
  const logger = new RecordingLogger();
  harness = createServerService({ dir, settings, models: await tinyModels(dir, settings, logger, false), logger });
  statuses = [];
  harness.status.onChange((next) => statuses.push(next.kind));
  power = new FakePowerEvents();
});

afterEach(async () => {
  reconnect?.dispose();
  reconnect = null;
  harness.service.dispose();
  await gateway.close();
  await rm(dir, { recursive: true, force: true });
});

function startReconnect(delaysMs: readonly number[] = DELAYS_MS): void {
  reconnect = new ServerReconnect({ status: harness.status, check: () => harness.service.check(), power, delaysMs });
  reconnect.start();
}

async function pair(service: ServerService): Promise<void> {
  const window = await gateway.openPairingWindow();
  service.pair(window.token);
  await window.admin.next();
  window.admin.send({ decision: 'approve' });
  await window.admin.next();
  window.admin.close();
  await expect.poll(async () => (await service.view()).server?.status.kind).toBe('online');
}

function offlineChecks(): number {
  return statuses.filter((kind) => kind === 'offline').length;
}

describe('ServerReconnect', () => {
  it('drops the language report when the server lost its models during a dictation and asks the server again', async () => {
    gateway.stt.setCapabilities(ROUTING_STT);
    await pair(harness.service);
    startReconnect();
    const selection: LanguageSelection = { mode: 'selected', selected: ['sk'] };
    const preparation = await new RemoteEngine({ connector: harness.connector, languages: new ServerLanguageGate(), selection: () => selection }).prepare();
    expect(preparation).toMatchObject({ ready: true });
    const dictation = (preparation as Extract<Preparation, { ready: true }>).engine.start({ languages: selection, signal: new AbortController().signal });
    const transcriptionOnly = { transcription: ROUTING_MODELS.transcription, conditioned: null, languageId: null };
    gateway.stt.setCapabilities({ status: 200, body: { languages: [], models: transcriptionOnly } });
    const reported: ServerStatus[] = [];
    harness.status.onChange((status) => reported.push(status));

    dictation.push(new Uint8Array(32_000).fill(3));

    await expect(dictation.finish()).rejects.toMatchObject({ reason: 'languages-missing' });
    await expect.poll(async () => (await harness.service.view()).server?.status).toMatchObject({ kind: 'online', languages: { kind: 'reported', languages: [], models: transcriptionOnly } });
    expect(reported[0]).toMatchObject({ kind: 'online', languages: { kind: 'reported', languages: [], models: UNKNOWN_MODELS } });
  });

  it('keeps checking an unreachable server with a growing delay and reconnects on its own once it is back', async () => {
    await pair(harness.service);
    startReconnect();
    await gateway.stop();

    await harness.service.check();
    expect((await harness.service.view()).server?.status).toEqual({ kind: 'offline' });
    await expect.poll(offlineChecks, { timeout: 2000 }).toBeGreaterThanOrEqual(3);

    await gateway.restart();

    await expect.poll(async () => (await harness.service.view()).server?.status.kind, { timeout: 2000 }).toBe('online');
  });

  it('waits between attempts instead of retrying in a busy loop', async () => {
    await pair(harness.service);
    startReconnect([150]);
    await gateway.stop();
    await harness.service.check();
    statuses.splice(0);

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(offlineChecks()).toBeGreaterThanOrEqual(1);
    expect(offlineChecks()).toBeLessThanOrEqual(3);
  });

  it('checks right away after the computer wakes up', async () => {
    await pair(harness.service);
    startReconnect([60_000]);
    await gateway.stop();
    await harness.service.check();
    await gateway.restart();
    statuses.splice(0);

    power.emit('resume');

    await expect.poll(async () => (await harness.service.view()).server?.status.kind, { timeout: 2000 }).toBe('online');
    expect(statuses).toContain('checking');
  });

  it('stops retrying once the server is switched off', async () => {
    await pair(harness.service);
    startReconnect([300]);
    await gateway.stop();
    await harness.service.check();

    await harness.service.setEnabled(false);
    statuses.splice(0);
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(statuses).not.toContain('checking');
    expect(statuses).not.toContain('offline');
  });

  it('removes its listeners when disposed', () => {
    startReconnect();
    expect(power.listenerCount()).toBe(2);

    reconnect?.dispose();

    expect(power.listenerCount()).toBe(0);
  });
});
