import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineSelector } from '../src/main/engines/engine-selector';
import { LocalEngine } from '../src/main/engines/local-engine';
import { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import { HotkeyService } from '../src/main/hotkey/hotkey-service';
import { InsertionService } from '../src/main/insertion/insertion-service';
import { LastTranscript } from '../src/main/insertion/last-transcript';
import { ModelManager } from '../src/main/models/model-manager';
import type { ServerPairing } from '../src/main/remote/pairing-repository';
import { RemoteEngine } from '../src/main/remote/remote-engine';
import { ServerConnector } from '../src/main/remote/server-connector';
import { PauseState } from '../src/main/session/pause-state';
import { MESSAGES } from '../src/main/session/overlay-messages';
import { SessionCoordinator } from '../src/main/session/session-coordinator';
import { coordinatorDictationGuard } from '../src/main/updates/coordinator-dictation-guard';
import { FakeCaptureHost } from './fake-capture-host';
import { WindowAudioCapture } from '../src/main/audio/window-audio-capture';
import { SettingsStore } from '../src/main/settings/settings-store';
import { StatsStore } from '../src/main/stats/stats-store';
import type { OverlayState } from '../src/shared/overlay-contract';
import type { Settings } from '../src/shared/settings';
import type { FakeSttBehaviour } from '../../server/test/support/fake-stt-server';
import { continuousSpeech } from '../../server/test/support/speech';
import { FAKE_WORKER } from './support/resident-fixture';
import { FakePowerEvents } from './fake-power-events';
import { InProcessCapture, stampedPcm } from './in-process-capture';
import { testEntry } from './model-fixtures';
import { RecordingLogger } from './recording-logger';
import { startTestGateway, type TestGateway } from './support/gateway';

const FN = { kind: 'modifiers', keycodes: [63], label: 'Fn / 🌐' } as const;
const MODEL_BODY = 'GGUF';
const silentObserver = { connected: () => undefined, failed: () => undefined };

const locals: LocalEngine[] = [];
let scratch: string;
let gateway: TestGateway;
let coordinator: SessionCoordinator | null = null;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-session-server-'));
  vi.stubEnv('FAKE_CLI_ARGS_FILE', join(scratch, 'args.txt'));
  vi.stubEnv('FAKE_CLI_MODE', 'echo-chunk');
});

afterEach(async () => {
  coordinator?.dispose();
  coordinator = null;
  await Promise.all(locals.splice(0).map((local) => local.dispose()));
  vi.unstubAllEnvs();
  await gateway.close();
  await rm(scratch, { recursive: true, force: true });
});

async function prepared(settingsPatch: Partial<Settings>, stt: FakeSttBehaviour = {}, gate: Promise<void> = Promise.resolve()) {
  gateway = await startTestGateway({ stt });
  const pairing: ServerPairing = await gateway.addDevice();
  const logger = new RecordingLogger();
  const settings = new SettingsStore(join(scratch, 'settings.json'), logger);
  await settings.load();
  await settings.update({ hotkey: FN, mode: 'hold', localModelId: 'tiny', ...settingsPatch });
  const modelsDir = join(scratch, 'models');
  await mkdir(modelsDir, { recursive: true });
  await writeFile(join(modelsDir, 'tiny.gguf'), MODEL_BODY);
  const models = new ModelManager({ dir: modelsDir, catalog: [testEntry('tiny', MODEL_BODY)], settings, warmUp: () => Promise.resolve(), logger });
  const local = new LocalEngine({ binary: FAKE_WORKER, models, settings, arch: 'arm64' });
  locals.push(local);
  const connector = new ServerConnector({ pairings: { load: () => gate.then(() => pairing) }, observer: silentObserver, clock: Date.now, timeoutMs: 2000 });
  const remote = new RemoteEngine({ connector, observer: silentObserver });
  const helper = new FakeInputHelper({ clipboard: 'original' });
  const hotkey = new HotkeyService(helper, settings, new FakePowerEvents(), () => Date.now(), logger);
  await hotkey.start();
  const capture = new InProcessCapture();
  const lastTranscript = new LastTranscript();
  const states: OverlayState[] = [];
  const opened: string[] = [];
  coordinator = new SessionCoordinator({
    hotkey,
    capture,
    engines: new EngineSelector([local, remote]),
    insertion: new InsertionService(helper, settings, lastTranscript, () => Promise.resolve(), logger),
    lastTranscript,
    helper,
    settings,
    stats: new StatsStore(join(scratch, 'stats.json'), undefined, logger),
    pause: new PauseState(logger),
    overlay: (state) => states.push(state),
    openServer: () => opened.push('server'),
    logger,
  });
  coordinator.start();
  return { helper, capture, lastTranscript, states, opened, pairing, logger, settings };
}

async function dictate(harness: Awaited<ReturnType<typeof prepared>>, pcm: Uint8Array): Promise<void> {
  harness.helper.emitHotkey('down');
  await expect.poll(() => harness.capture.recording).toBe(true);
  harness.capture.speak(pcm);
  harness.helper.emitHotkey('up');
}

function lastVisible(states: OverlayState[]): OverlayState | undefined {
  return states.filter((state) => state.kind !== 'hidden').at(-1);
}

describe('SessionCoordinator with the server engine', () => {
  it('transcribes on the server when the order says Server', async () => {
    const harness = await prepared({ engineOrder: ['server'] }, { respond: () => ({ status: 200, body: { text: 'zo servera' } }) });

    await dictate(harness, stampedPcm(4));

    await expect.poll(() => harness.helper.pasted).toEqual(['zo servera']);
    expect(gateway.stt.requests).toEqual([{ language: 'sk', bytes: 32000 }]);
  });

  it('falls back to the local engine when the server is down and never sends audio', async () => {
    const harness = await prepared({ engineOrder: ['server', 'local'] });
    await gateway.stop();

    await dictate(harness, stampedPcm(6));

    await expect.poll(() => harness.helper.pasted).toEqual(['6:32000']);
    expect(gateway.stt.requests).toEqual([]);
  });

  it('reports a retired eager local preparation after the primary connection fails without leaking capture', async () => {
    const gate = Promise.withResolvers<void>();
    vi.stubEnv('CW_WORKER_STARTS', join(scratch, 'starts'));
    const harness = await prepared({ engineOrder: ['server', 'local'] }, {}, gate.promise);
    await gateway.stop();
    harness.helper.emitHotkey('down');
    await expect.poll(() => readFile(join(scratch, 'starts'), 'utf8').catch(() => '')).not.toBe('');
    await harness.settings.update({ localModelId: null });
    gate.resolve();
    await expect.poll(() => lastVisible(harness.states)).toMatchObject({ kind: 'error' });
    await expect.poll(() => harness.capture.recording).toBe(false);
    expect(harness.helper.pasted).toEqual([]);
  });

  it('uses the server when local is not ready and the order allows it', async () => {
    const harness = await prepared({ engineOrder: ['local', 'server'], localModelId: null }, { respond: () => ({ status: 200, body: { text: 'záložný server' } }) });

    await dictate(harness, stampedPcm(2));

    await expect.poll(() => harness.helper.pasted).toEqual(['záložný server']);
  });

  it('never sends audio to the server with the local order even without a model', async () => {
    const harness = await prepared({ engineOrder: ['local'], localModelId: null });

    await dictate(harness, stampedPcm(2));

    await expect.poll(() => lastVisible(harness.states)).toMatchObject({ kind: 'error', message: MESSAGES.noModel });
    expect(gateway.stt.requests).toEqual([]);
  });

  it('keeps the text recognised before the server failed and offers to copy it', async () => {
    const harness = await prepared({ engineOrder: ['server'] }, { respond: (pcm) => (pcm.length === 64000 ? { status: 500, body: {} } : { status: 200, body: { text: 'toto je začiatok' } }) });

    await dictate(harness, continuousSpeech(26));

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: MESSAGES.serverSttUnavailable, action: 'copy-last' });
    expect(harness.lastTranscript.get()).toBe('toto je začiatok');
    expect(harness.helper.pasted).toEqual([]);
  });

  it('a dictation cancelled while the server connection is still opening sends nothing', async () => {
    const opening = Promise.withResolvers<void>();
    const harness = await prepared({ engineOrder: ['server'] }, {}, opening.promise);

    await dictate(harness, stampedPcm(4));
    await new Promise((resolve) => setTimeout(resolve, 50));
    coordinator?.dispose();
    opening.resolve();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(gateway.stt.requests).toEqual([]);
    expect(gateway.server.gateway.sessions.count()).toBe(0);
    expect(harness.helper.pasted).toEqual([]);
  });

  it('shows a hard re-pair error with Server, potom lokálne after a revoke and never transcribes locally', async () => {
    const harness = await prepared({ engineOrder: ['server', 'local'] });
    await gateway.admin({ cmd: 'revoke', deviceId: harness.pairing.deviceId });

    await dictate(harness, stampedPcm(4));

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: MESSAGES.serverRepair, action: 'open-server' });
    expect(harness.helper.pasted).toEqual([]);
    coordinator?.act('open-server');
    expect(harness.opened).toEqual(['server']);
  });

  it('reports a server dictation as active to the update guard until its result is inserted', async () => {
    const harness = await prepared({ engineOrder: ['server'] }, { delayMs: 400, respond: () => ({ status: 200, body: { text: 'po aktualizácii' } }) });
    const guard = coordinatorDictationGuard({ coordinator: () => coordinator as SessionCoordinator, microphone: new WindowAudioCapture(new FakeCaptureHost(), harness.logger), meter: { stopMeter: () => Promise.resolve() }, logger: harness.logger });

    await dictate(harness, stampedPcm(3));
    await expect.poll(() => gateway.stt.requests.length).toBe(1);

    expect(guard.isDictating()).toBe(true);
    await expect.poll(() => harness.helper.pasted, { timeout: 5000 }).toEqual(['po aktualizácii']);
    await expect.poll(() => guard.isDictating()).toBe(false);
  });
});
