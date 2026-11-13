import type { Clock } from '@codevo-whisper/audio';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowAudioCapture } from '../src/main/audio/window-audio-capture';
import { EngineRouting } from '../src/main/engines/engine-routing';
import { EngineSelector } from '../src/main/engines/engine-selector';
import { LocalEngine } from '../src/main/engines/local-engine';
import { FakeInputHelper, type FakeInputHelperState } from '../src/main/helper/fake-input-helper';
import type { AppTarget } from '../src/main/helper/input-helper';
import { HistoryStore } from '../src/main/history/history-store';
import { HotkeyService } from '../src/main/hotkey/hotkey-service';
import { InsertionService } from '../src/main/insertion/insertion-service';
import { LastTranscript } from '../src/main/insertion/last-transcript';
import { ActiveModelReadiness } from '../src/main/models/local-model-readiness';
import { ModelManager } from '../src/main/models/model-manager';
import type { ServerService } from '../src/main/remote/server-service';
import { PauseState } from '../src/main/session/pause-state';
import { MESSAGES } from '../src/main/session/overlay-messages';
import { SessionCoordinator } from '../src/main/session/session-coordinator';
import { FailedRecording } from '../src/main/session/failed-recording';
import { SettingsStore } from '../src/main/settings/settings-store';
import { coordinatorDictationGuard } from '../src/main/updates/coordinator-dictation-guard';
import { StatsStore } from '../src/main/stats/stats-store';
import { localDate } from '../src/shared/calendar-date';
import { offeredActions, type LiveText, type OverlayState, type OverlayTarget } from '../src/shared/overlay-contract';
import type { Preparation } from '../src/main/engines/transcription-engine';
import type { Settings } from '../src/shared/settings';
import { FAKE_WORKER, readRecordedCalls } from './support/resident-fixture';
import { FakeCaptureHost } from './fake-capture-host';
import { FakePowerEvents } from './fake-power-events';
import { InProcessCapture, stampedPcm } from './in-process-capture';
import { testEntry } from './model-fixtures';
import { RecordingLogger } from './recording-logger';
import { createServerService } from './support/server-service';
import { QuitGate } from '../src/main/app/quit-gate';
import type { Polished, PolishRequest } from '../src/main/ai/polish';
import { expectedText, secondFrames, timelineSpeech, writeTimeline } from './support/timeline-audio';

const FN = { kind: 'modifiers', keycodes: [63], label: 'Fn / 🌐' } as const;
const MODEL_BODY = 'GGUF';
const NOTES: AppTarget = { bundleId: 'com.apple.Notes', pid: 200, name: 'Notes', windowId: 4 };
const AI_SERVER: Partial<Settings> = { aiBaseUrl: 'http://127.0.0.1:11434/v1', aiModel: 'qwen2.5:1.5b' };
const ONE_SECOND_TEXT = (marker: number): string => `${marker}:32000`;
const FAKE_TIMELINE_CLI = fileURLToPath(new URL('./support/resident-worker.js', import.meta.url));

type Setup = { languageHint?: 'required'; appIcon?: (path: string) => Promise<string | null>; polish?: (request: PolishRequest, signal: AbortSignal) => Promise<Polished>; settings?: Partial<Settings>; helper?: Partial<FakeInputHelperState>; binary?: string; platform?: NodeJS.Platform; clock?: () => number; engineClock?: Clock; inputHelper?: FakeInputHelper; pasteDelay?: 'default' };

type Harness = Awaited<ReturnType<typeof prepared>>;

const locals: LocalEngine[] = [];
const servers: ServerService[] = [];
const stores: Array<{ stats: StatsStore; history: HistoryStore }> = [];
let scratch: string;
let argsFile: string;
let coordinator: SessionCoordinator | null = null;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-session-'));
  argsFile = join(scratch, 'args.txt');
  vi.stubEnv('FAKE_CLI_ARGS_FILE', argsFile);
  await setWorkerMode('echo-chunk');
});

afterEach(async () => {
  await coordinator?.shutdown();
  coordinator = null;
  await Promise.all(locals.splice(0).map((local) => local.dispose()));
  servers.splice(0).forEach((server) => server.dispose());
  await Promise.all(stores.splice(0).map(({ stats, history }) => Promise.all([stats.days(), history.view()])));
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

async function setWorkerMode(mode: string): Promise<void> {
  vi.stubEnv('FAKE_CLI_MODE', mode);
  vi.stubEnv('CW_WORKER_CONTROL', join(scratch, 'worker-mode'));
  await writeFile(join(scratch, 'worker-mode'), mode);
}

async function prepared(setup: Setup = {}) {
  const logger = new RecordingLogger();
  const settings = new SettingsStore(join(scratch, 'settings.json'), logger);
  await settings.load();
  await settings.update({ hotkey: FN, mode: 'hold', localModelId: 'tiny', ...setup.settings });
  const modelsDir = join(scratch, 'models');
  await mkdir(modelsDir, { recursive: true });
  await writeFile(join(modelsDir, 'tiny.gguf'), MODEL_BODY);
  const models = new ModelManager({ dir: modelsDir, catalog: [testEntry('tiny', MODEL_BODY, setup.languageHint === undefined ? {} : { languageHint: setup.languageHint })], settings, warmUp: () => Promise.resolve(), logger });
  const engineClock = setup.engineClock === undefined ? {} : { clock: setup.engineClock };
  const engine = new LocalEngine({ binary: setup.binary ?? FAKE_WORKER, acceleratorBinary: setup.binary ?? FAKE_WORKER, models, settings, arch: 'arm64', platform: setup.platform ?? process.platform, ...engineClock });
  locals.push(engine);
  const helper = setup.inputHelper ?? new FakeInputHelper({ clipboard: 'original', ...setup.helper });
  const power = new FakePowerEvents();
  const hotkey = new HotkeyService(helper, settings, power, setup.clock ?? (() => Date.now()), logger);
  await hotkey.start();
  const capture = new InProcessCapture();
  const lastTranscript = new LastTranscript();
  const insertion = new InsertionService(helper, settings, lastTranscript, setup.pasteDelay === 'default' ? undefined : () => Promise.resolve(), logger);
  const states: OverlayState[] = [];
  const settingsOpened: string[] = [];
  const stats = new StatsStore(join(scratch, 'stats.json'), undefined, logger);
  const history = new HistoryStore(join(scratch, 'history.json'), logger);
  stores.push({ stats, history });
  await history.configure({ enabled: true, limit: 100 });
  const pause = new PauseState(logger);
  const server = createServerService({ dir: scratch, settings, models, logger });
  servers.push(server.service);
  const failedRecording = new FailedRecording();
  coordinator = new SessionCoordinator({
    hotkey,
    capture,
    engines: new EngineSelector([engine]),
    routing: new EngineRouting({ order: server.order, local: new ActiveModelReadiness(models, settings), server: server.service }),
    insertion,
    lastTranscript,
    helper,
    settings,
    stats,
    history,
    pause,
    overlay: (state) => states.push(state),
    openSettings: () => settingsOpened.push('settings'),
    openLanguageSettings: () => settingsOpened.push('languages'),
    openServer: () => settingsOpened.push('server'),
    openModelSettings: () => settingsOpened.push('local-model'),
    ...(setup.polish === undefined ? {} : { polish: setup.polish }),
    failedRecording,
    ...(setup.appIcon === undefined ? {} : { appIcon: setup.appIcon }),
    ...(setup.platform === undefined ? {} : { platform: setup.platform }),
    logger,
  });
  coordinator.start();
  return { settings, helper, power, hotkey, capture, lastTranscript, states, settingsOpened, logger, coordinator, modelsDir, stats, history, pause, failedRecording };
}

async function pressAndSpeak(harness: Harness, marker: number): Promise<void> {
  const starts = harness.capture.starts.length;
  harness.helper.emitHotkey('down');
  await expect.poll(() => harness.capture.starts.length).toBe(starts + 1);
  harness.capture.speak(stampedPcm(marker));
}

async function dictate(harness: Harness, marker: number): Promise<void> {
  await pressAndSpeak(harness, marker);
  harness.helper.emitHotkey('up');
}

function cancelVia(harness: Harness, via: 'escape' | 'overlay button'): void {
  const cancel = { escape: () => harness.helper.pressSessionShortcut('cancel'), 'overlay button': () => harness.coordinator.act('cancel') };
  cancel[via]();
}

function kinds(states: OverlayState[]): string[] {
  return states.map((state) => state.kind).filter((kind, index, all) => kind !== all[index - 1]);
}

function lastVisible(states: OverlayState[]): OverlayState | undefined {
  return states.filter((state) => state.kind !== 'hidden').at(-1);
}

function shownTarget(states: OverlayState[]): OverlayTarget | undefined {
  const recording = states.filter((state) => state.kind === 'recording').at(-1);
  return recording?.kind === 'recording' ? recording.target : undefined;
}

function lockVia(harness: Harness, via: 'shortcut' | 'overlay button'): void {
  const lock = { shortcut: () => harness.helper.pressSessionShortcut('lock-target'), 'overlay button': () => harness.coordinator.act('lock-target') };
  lock[via]();
}

describe('SessionCoordinator target lock', () => {
  it('shows the target app with its icon while recording and leaves an unlocked dictation as before', async () => {
    const icons: string[] = [];
    const harness = await prepared({ appIcon: (path) => { icons.push(path); return Promise.resolve('data:image/png;base64,AAAA'); } });
    harness.helper.iconPath = '/System/Applications/TextEdit.app';

    await pressAndSpeak(harness, 7);
    await expect.poll(() => shownTarget(harness.states)).toEqual({ name: 'TextEdit', icon: 'data:image/png;base64,AAAA', lock: 'unlocked' });
    const shown = harness.states.at(-1);
    expect(shown && offeredActions(shown)).toEqual(['cycle-language', 'lock-target', 'cancel']);
    harness.helper.emitHotkey('up');

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    expect(icons).toEqual(['/System/Applications/TextEdit.app']);
    expect(harness.helper.refocused).toEqual([]);
    expect(harness.helper.returned).toEqual([]);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('no icon'))],
    ['finds none', () => Promise.resolve(null)],
  ] as const)('shows the target without an icon when the icon lookup %s', async (_label, appIcon) => {
    const harness = await prepared({ appIcon });
    harness.helper.iconPath = '/System/Applications/TextEdit.app';
    await pressAndSpeak(harness, 7);
    await expect.poll(() => shownTarget(harness.states)).toEqual({ name: 'TextEdit', lock: 'unlocked' });
  });

  it.each(['shortcut', 'overlay button'] as const)('locks the target via the %s and inserts there after the user moved away', async (via) => {
    const harness = await prepared({ settings: { autoSubmit: 'enter' } });
    await pressAndSpeak(harness, 7);
    await expect.poll(() => shownTarget(harness.states)?.lock).toBe('unlocked');

    lockVia(harness, via);
    expect(shownTarget(harness.states)?.lock).toBe('locked');
    harness.helper.frontmostApp = NOTES;
    harness.helper.refocusResult = 'moved';
    harness.helper.emitHotkey('up');

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    await expect.poll(() => harness.helper.returned).toEqual(['capture-1']);
    expect(harness.helper.refocused).toEqual(['capture-1']);
    expect(harness.helper.submitted).toEqual([]);
    expect(harness.helper.frontmostApp).toEqual(NOTES);
  });

  it('unlocks on a second toggle and ignores a toggle once recording stopped', async () => {
    const harness = await prepared();
    await pressAndSpeak(harness, 7);
    await expect.poll(() => shownTarget(harness.states)?.lock).toBe('unlocked');

    lockVia(harness, 'overlay button');
    lockVia(harness, 'shortcut');
    expect(shownTarget(harness.states)?.lock).toBe('unlocked');
    harness.helper.emitHotkey('up');
    lockVia(harness, 'shortcut');
    lockVia(harness, 'overlay button');

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    expect(harness.helper.refocused).toEqual([]);
  });

  it('offers no lock when the captured field belongs to another app', async () => {
    const harness = await prepared();
    harness.helper.captureTarget = () => Promise.resolve({ captureId: 'capture-other', target: NOTES, iconPath: '/System/Applications/Notes.app' });
    await pressAndSpeak(harness, 7);
    await expect.poll(() => shownTarget(harness.states)).toEqual({ name: 'TextEdit', lock: 'unavailable' });
    const shown = harness.states.at(-1);
    expect(shown && offeredActions(shown)).toEqual(['cycle-language', 'cancel']);

    lockVia(harness, 'shortcut');
    lockVia(harness, 'overlay button');
    harness.helper.emitHotkey('up');

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    expect(harness.helper.refocused).toEqual([]);
  });

  it('still dictates when the target capture fails', async () => {
    const harness = await prepared();
    harness.helper.captureTarget = () => Promise.reject(new Error('capture crashed'));
    await pressAndSpeak(harness, 7);
    await expect.poll(() => shownTarget(harness.states)).toEqual({ name: 'TextEdit', lock: 'unavailable' });
    harness.helper.emitHotkey('up');

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    expect(harness.logger.errors.some((entry) => String(entry.error).includes('capture crashed'))).toBe(true);
  });

  it.each([
    ['an unlocked insertion', async (harness: Harness) => { await dictate(harness, 7); }],
    ['a locked insertion into a field the user left', async (harness: Harness) => {
      await pressAndSpeak(harness, 7);
      await expect.poll(() => shownTarget(harness.states)?.lock).toBe('unlocked');
      lockVia(harness, 'shortcut');
      harness.helper.frontmostApp = NOTES;
      harness.helper.refocusResult = 'moved';
      harness.helper.emitHotkey('up');
      await expect.poll(() => harness.helper.returned).toEqual(['capture-1']);
    }],
    ['a blocked locked insertion', async (harness: Harness) => {
      await pressAndSpeak(harness, 7);
      await expect.poll(() => shownTarget(harness.states)?.lock).toBe('unlocked');
      lockVia(harness, 'shortcut');
      harness.helper.refocusResult = 'failed';
      harness.helper.emitHotkey('up');
      await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'blocked', reason: 'focus' });
    }],
    ['a cancelled recording', async (harness: Harness) => {
      await pressAndSpeak(harness, 7);
      cancelVia(harness, 'escape');
    }],
    ['an abandoned recording', async (harness: Harness) => {
      await harness.settings.update({ localModelId: null });
      harness.helper.emitHotkey('down');
      await expect.poll(() => lastVisible(harness.states)).toMatchObject({ kind: 'error', message: 'Lokálny model chýba' });
    }],
    ['a failed transcription', async (harness: Harness) => {
      await setWorkerMode('fail');
      await dictate(harness, 3);
      await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Prepis sa nepodaril', action: 'retry' });
    }],
    ['a shutdown', async (harness: Harness) => {
      await pressAndSpeak(harness, 7);
      await expect.poll(() => shownTarget(harness.states)?.lock).toBe('unlocked');
      await harness.coordinator.shutdown();
    }],
  ] as const)('releases the target capture once after %s', async (_case, run) => {
    const harness = await prepared();
    await run(harness);
    await expect.poll(() => harness.helper.released).toEqual(['capture-1']);
    await harness.coordinator.settled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(harness.helper.released).toEqual(['capture-1']);
  });

  it('releases a capture of another app while still recording', async () => {
    const harness = await prepared();
    harness.helper.captureTarget = () => Promise.resolve({ captureId: 'capture-other', target: NOTES, iconPath: null });
    await pressAndSpeak(harness, 7);
    await expect.poll(() => harness.helper.released).toEqual(['capture-other']);
    expect(harness.capture.recording).toBe(true);
    harness.helper.emitHotkey('up');
    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    expect(harness.helper.released).toEqual(['capture-other']);
  });

  it('keeps the locked capture until its insertion has finished', async () => {
    const pasteGate = Promise.withResolvers<void>();
    const pasteEntered = Promise.withResolvers<void>();
    class BlockedPasteHelper extends FakeInputHelper {
      override async paste(captureId?: string): Promise<void> {
        pasteEntered.resolve();
        await pasteGate.promise;
        await super.paste(captureId);
      }
    }
    const harness = await prepared({ inputHelper: new BlockedPasteHelper({ clipboard: 'original' }) });
    await pressAndSpeak(harness, 7);
    await expect.poll(() => shownTarget(harness.states)?.lock).toBe('unlocked');
    lockVia(harness, 'shortcut');
    harness.helper.emitHotkey('up');
    await pasteEntered.promise;
    await harness.coordinator.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(harness.helper.released).toEqual([]);
    pasteGate.resolve();
    await expect.poll(() => harness.helper.released).toEqual(['capture-1']);
    expect(harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
  });

  it('gives a recording started during a locked transcription its own capture and inserts the first with its own', async () => {
    vi.stubEnv('FAKE_CLI_DELAY_S', '0.4');
    const harness = await prepared();
    await pressAndSpeak(harness, 7);
    await expect.poll(() => shownTarget(harness.states)?.lock).toBe('unlocked');
    lockVia(harness, 'shortcut');
    harness.helper.frontmostApp = NOTES;
    harness.helper.refocusResult = 'moved';
    harness.helper.emitHotkey('up');
    await expect.poll(() => readRecordedCalls(argsFile)).toHaveLength(1);
    await pressAndSpeak(harness, 9);
    await expect.poll(() => shownTarget(harness.states)).toEqual({ name: 'Notes', lock: 'unlocked' });
    harness.helper.emitHotkey('up');

    await expect.poll(() => harness.helper.pasted, { timeout: 4000 }).toEqual([ONE_SECOND_TEXT(7), ONE_SECOND_TEXT(9)]);
    expect(harness.helper.refocused).toEqual(['capture-1']);
    await expect.poll(() => [...harness.helper.released].sort()).toEqual(['capture-1', 'capture-2']);
  });

  it('leaves the target lock shortcut unarmed when the dictation hotkey is Ctrl+Shift+L', async () => {
    const harness = await prepared({ platform: 'linux', settings: { hotkey: { kind: 'key', keycode: 0x20000 + 38, modifiers: ['control', 'shift'], label: 'Ctrl+Shift+L' } } });
    await pressAndSpeak(harness, 7);
    expect(harness.helper.sessionShortcuts.map(({ action }) => action)).toEqual(['cancel', 'cycle-language']);
  });

  it('shows no target when the frontmost app is unknown', async () => {
    const harness = await prepared({ helper: { frontmost: null } });
    await dictate(harness, 7);
    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    expect(harness.states.filter((state) => state.kind === 'recording').every((state) => state.target === undefined)).toBe(true);
  });
});

describe('SessionCoordinator', () => {
  it.each(['mode change', 'tray pause'] as const)('retains failed restoration after %s cancellation settles', async (action) => {
    const harness = await prepared({ settings: { muteWhileRecording: true } });
    const restoring = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const begin = harness.helper.beginRecordingAudio.bind(harness.helper);
    harness.helper.beginRecordingAudio = async (settings) => {
      await begin(settings);
      return { finish: async () => {
        restoring.resolve();
        await release.promise;
        throw new Error('restore-failed-cancellation');
      } };
    };
    await pressAndSpeak(harness, 7);
    await (action === 'mode change' ? harness.settings.update({ mode: 'toggle' }) : harness.coordinator.pause());
    await restoring.promise;
    expect(harness.capture.recording).toBe(false);
    release.resolve();
    await harness.coordinator.settled();
    await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
    expect(harness.helper.outputMuted).toBe(true);
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.logger.errors.some((entry) => String(entry.error).includes('restore-failed-cancellation'))).toBe(true);
    expect(harness.states.at(-1)).toEqual({ kind: 'error', message: 'Zvukový výstup sa nepodarilo nastaviť alebo obnoviť. Skontrolujte zvuk systému.' });
  });
  it.each(['mode change', 'tray pause'] as const)('hides after successful restoration on %s cancellation', async (action) => {
    const harness = await prepared({ settings: { muteWhileRecording: true } });
    await pressAndSpeak(harness, 7);
    await (action === 'mode change' ? harness.settings.update({ mode: 'toggle' }) : harness.coordinator.pause());
    await harness.coordinator.settled();
    await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
    expect(harness.capture.recording).toBe(false);
    expect(harness.helper.outputMuted).toBe(false);
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.states.at(-1)).toEqual({ kind: 'hidden' });
  });
  it('restores pending audio after engine abandonment without a late microphone start', async () => {
    const harness = await prepared({ settings: { muteWhileRecording: true, audioFeedback: true, localModelId: null } });
    const acquiring = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const begin = harness.helper.beginRecordingAudio.bind(harness.helper);
    harness.helper.beginRecordingAudio = async (settings) => {
      acquiring.resolve();
      await release.promise;
      return begin(settings);
    };
    harness.helper.emitHotkey('down');
    await acquiring.promise;
    await expect.poll(() => lastVisible(harness.states)).toMatchObject({ kind: 'error', message: 'Lokálny model chýba' });
    release.resolve();
    await harness.coordinator.settled();
    expect(harness.capture.starts).toEqual([]);
    expect(harness.helper.outputMuted).toBe(false);
    expect(harness.helper.audioTrace).toEqual(['start:default:50', 'mute', 'restore:false']);
  });
  it('expires the abandonment notice before pending acquisition settles without reviving it', async () => {
    const harness = await prepared({ settings: { muteWhileRecording: true, localModelId: null } });
    const acquiring = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const begin = harness.helper.beginRecordingAudio.bind(harness.helper);
    harness.helper.beginRecordingAudio = async (settings) => {
      acquiring.resolve();
      await release.promise;
      return begin(settings);
    };
    harness.helper.emitHotkey('down');
    await acquiring.promise;
    await expect.poll(() => harness.states.at(-1)).toMatchObject({ kind: 'error', message: 'Lokálny model chýba' });
    expect(harness.capture.recording).toBe(false);
    expect(harness.coordinator.isBusy()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 4100));
    expect(harness.states.at(-1)).toEqual({ kind: 'hidden' });
    release.resolve();
    await harness.coordinator.settled();
    await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
    expect(harness.capture.starts).toEqual([]);
    expect(harness.helper.outputMuted).toBe(false);
    expect(harness.states.at(-1)).toEqual({ kind: 'hidden' });
  }, 10000);
  it('keeps the original restoration notice deadline through a held paste and default paste delay', async () => {
    const pasteEntered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    class HeldPasteHelper extends FakeInputHelper {
      override async paste(): Promise<void> {
        pasteEntered.resolve();
        await release.promise;
        await super.paste();
      }
    }
    const harness = await prepared({ inputHelper: new HeldPasteHelper({ clipboard: 'original' }), settings: { muteWhileRecording: true }, pasteDelay: 'default' });
    const begin = harness.helper.beginRecordingAudio.bind(harness.helper);
    harness.helper.beginRecordingAudio = async (settings) => {
      await begin(settings);
      return { finish: () => Promise.reject(new Error('restore-failed-held-paste')) };
    };
    await dictate(harness, 7);
    await pasteEntered.promise;
    expect(harness.coordinator.isBusy()).toBe(true);
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.states.at(-1)).toMatchObject({ kind: 'error', message: 'Zvukový výstup sa nepodarilo nastaviť alebo obnoviť. Skontrolujte zvuk systému.' });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(harness.states.at(-1)?.kind).toBe('error');
    release.resolve();
    await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
    expect(harness.helper.pasted).toEqual(['7:32000']);
    expect(harness.helper.clipboard).toBe('original');
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(harness.states.at(-1)).toEqual({ kind: 'hidden' });
    expect(harness.helper.outputMuted).toBe(true);
  }, 10000);
  it('does not revive an expired newer utility notice when stale cleanup fails', async () => {
    const harness = await prepared({ settings: { muteWhileRecording: true } });
    const restoring = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const begin = harness.helper.beginRecordingAudio.bind(harness.helper);
    harness.helper.beginRecordingAudio = async (settings) => {
      await begin(settings);
      return { finish: async () => {
        restoring.resolve();
        await release.promise;
        throw new Error('restore-failed-stale');
      } };
    };
    await pressAndSpeak(harness, 7);
    harness.hotkey.cancel();
    await restoring.promise;
    expect(await harness.coordinator.copyLast()).toBe('no-transcript');
    expect(harness.states.at(-1)).toMatchObject({ kind: 'error', message: 'Zatiaľ nemáte žiadny prepis' });
    await new Promise((resolve) => setTimeout(resolve, 4100));
    expect(harness.states.at(-1)).toEqual({ kind: 'hidden' });
    const expired = harness.states.length;
    release.resolve();
    await harness.coordinator.settled();
    await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
    expect(harness.states.slice(expired)).toEqual([]);
    expect(harness.helper.outputMuted).toBe(true);
    expect(harness.helper.pasted).toEqual([]);
  }, 10000);
  it('keeps the next recording visible when stale cancellation restoration fails', async () => {
    const harness = await prepared({ settings: { muteWhileRecording: true } });
    const restoring = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const begin = harness.helper.beginRecordingAudio.bind(harness.helper);
    let first = true;
    harness.helper.beginRecordingAudio = async (settings) => {
      const lease = await begin(settings);
      if (!first) return lease;
      first = false;
      return { finish: async () => {
        restoring.resolve();
        await release.promise;
        throw new Error('restore-failed-previous-recording');
      } };
    };
    await pressAndSpeak(harness, 7);
    harness.hotkey.cancel();
    await restoring.promise;
    harness.helper.emitHotkey('down');
    expect(harness.states.at(-1)?.kind).toBe('recording');
    release.resolve();
    await expect.poll(() => harness.capture.starts).toHaveLength(2);
    expect(harness.states.at(-1)?.kind).toBe('recording');
    harness.capture.speak(stampedPcm(8));
    harness.helper.emitHotkey('up');
    await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
    expect(harness.helper.pasted).toEqual(['8:32000']);
    expect(harness.states.at(-1)).toEqual({ kind: 'inserted', appName: 'TextEdit' });
  });
  it('does not revive shutdown presentation when held restoration fails', async () => {
    const harness = await prepared({ settings: { muteWhileRecording: true, audioFeedback: true } });
    const restoring = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const begin = harness.helper.beginRecordingAudio.bind(harness.helper);
    harness.helper.beginRecordingAudio = async (settings) => {
      await begin(settings);
      return { finish: async () => {
        restoring.resolve();
        await release.promise;
        throw new Error('restore-failed-shutdown');
      } };
    };
    await pressAndSpeak(harness, 7);
    const shutdown = harness.coordinator.shutdown();
    await restoring.promise;
    const state = harness.states.at(-1);
    release.resolve();
    await shutdown;
    harness.helper.emitHotkey('down');
    expect(harness.states.at(-1)).toEqual(state);
    expect(harness.capture.recording).toBe(false);
    expect(harness.capture.starts).toHaveLength(1);
    expect(harness.helper.outputMuted).toBe(true);
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.logger.errors.some((entry) => String(entry.error).includes('restore-failed-shutdown'))).toBe(true);
  });
  it('holds a rapid following recording behind unfinished restoration', async () => {
    const harness = await prepared({ settings: { muteWhileRecording: true, audioFeedback: true } });
    const restoring = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const begin = harness.helper.beginRecordingAudio.bind(harness.helper);
    let first = true;
    harness.helper.beginRecordingAudio = async (settings) => {
      const lease = await begin(settings);
      if (!first) return lease;
      first = false;
      return { finish: async (options) => { restoring.resolve(); await release.promise; await lease.finish(options); } };
    };
    await pressAndSpeak(harness, 7);
    harness.helper.emitHotkey('up');
    await restoring.promise;
    harness.helper.emitHotkey('down');
    expect(harness.capture.starts).toHaveLength(1);
    expect(harness.helper.audioTrace).toEqual(['start:default:50', 'mute']);
    release.resolve();
    await expect.poll(() => harness.capture.starts).toHaveLength(2);
    harness.capture.speak(stampedPcm(8));
    harness.helper.emitHotkey('up');
    await expect.poll(() => harness.helper.pasted).toEqual(['7:32000', '8:32000']);
    expect(harness.helper.outputMuted).toBe(false);
  });
  it('keeps the saved mute state and recording preferences through cancellation', async () => {
    const harness = await prepared({ settings: { muteWhileRecording: true, audioFeedback: true, feedbackOutputId: 'speakers', feedbackVolume: 73 } });
    harness.helper.outputMuted = true;
    await pressAndSpeak(harness, 7);
    await harness.settings.update({ muteWhileRecording: false, audioFeedback: false, feedbackOutputId: null, feedbackVolume: 1 });
    harness.hotkey.cancel();
    await harness.coordinator.settled();
    expect(harness.helper.outputMuted).toBe(true);
    expect(harness.helper.audioTrace).toEqual(['start:speakers:73', 'mute', 'restore:true', 'stop:speakers:73']);
    await pressAndSpeak(harness, 8);
    harness.helper.emitHotkey('up');
    await harness.coordinator.settled();
    expect(harness.helper.audioTrace).toHaveLength(4);
  });
  it('restores without a stop cue when microphone start fails', async () => {
    const harness = await prepared({ settings: { muteWhileRecording: true, audioFeedback: true } });
    harness.capture.failNextStart = true;
    harness.helper.emitHotkey('down');
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Mikrofón sa nepodarilo zapnúť' });
    expect(harness.helper.outputMuted).toBe(false);
    expect(harness.helper.audioTrace).toEqual(['start:default:50', 'mute', 'restore:false']);
  });
  it('restores even when microphone stop rejects', async () => {
    const harness = await prepared({ settings: { muteWhileRecording: true, audioFeedback: true } });
    await pressAndSpeak(harness, 7);
    const stop = harness.capture.stop.bind(harness.capture);
    harness.capture.stop = async () => { await stop(); throw new Error('capture-stop-failed'); };
    harness.hotkey.cancel();
    await harness.coordinator.settled();
    expect(harness.capture.recording).toBe(false);
    expect(harness.helper.outputMuted).toBe(false);
    expect(harness.helper.audioTrace).toEqual(['start:default:50', 'mute', 'restore:false', 'stop:default:50']);
  });
  it('preserves recorded PCM and reports restoration failure', async () => {
    const pcmFile = join(scratch, 'worker.pcm');
    vi.stubEnv('CW_WORKER_PCM_FILE', pcmFile);
    const harness = await prepared({ settings: { muteWhileRecording: true }, pasteDelay: 'default' });
    const begin = harness.helper.beginRecordingAudio.bind(harness.helper);
    harness.helper.beginRecordingAudio = async (settings) => {
      await begin(settings);
      return { finish: () => Promise.reject(new Error('restore-failed')) };
    };
    await dictate(harness, 7);
    await expect.poll(() => harness.helper.pasted).toEqual(['7:32000']);
    await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
    expect(harness.helper.outputMuted).toBe(true);
    expect(harness.lastTranscript.get()).toBe('7:32000');
    expect(harness.helper.clipboard).toBe('original');
    expect(await readFile(pcmFile)).toEqual(Buffer.from(stampedPcm(7)));
    expect(await harness.stats.days()).toEqual([{ date: localDate(new Date()), words: 1, dictations: 1, seconds: 1 }]);
    expect(await harness.history.view()).toMatchObject({ entries: [{ text: ONE_SECOND_TEXT(7) }] });
    expect(harness.logger.errors.some((entry) => String(entry.error).includes('restore-failed'))).toBe(true);
    expect(harness.states.some((state) => state.kind === 'error' && state.message.includes('Zvukový výstup'))).toBe(true);
    expect(lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Zvukový výstup sa nepodarilo nastaviť alebo obnoviť. Skontrolujte zvuk systému.' });
    expect(harness.states.at(-1)?.kind).toBe('error');
  });
  it('keeps normal success after restored audio and default paste settle', async () => {
    const pcmFile = join(scratch, 'worker.pcm');
    vi.stubEnv('CW_WORKER_PCM_FILE', pcmFile);
    const harness = await prepared({ settings: { muteWhileRecording: true }, pasteDelay: 'default' });
    await dictate(harness, 7);
    await expect.poll(() => harness.helper.pasted).toEqual(['7:32000']);
    await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
    expect(harness.helper.outputMuted).toBe(false);
    expect(harness.lastTranscript.get()).toBe('7:32000');
    expect(harness.helper.clipboard).toBe('original');
    expect(await readFile(pcmFile)).toEqual(Buffer.from(stampedPcm(7)));
    expect(await harness.stats.days()).toEqual([{ date: localDate(new Date()), words: 1, dictations: 1, seconds: 1 }]);
    expect(lastVisible(harness.states)).toEqual({ kind: 'inserted', appName: 'TextEdit' });
    expect(harness.states.some((state) => state.kind === 'error')).toBe(false);
    expect(harness.states.at(-1)?.kind).toBe('inserted');
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(harness.states.at(-1)).toEqual({ kind: 'hidden' });
  });
  it('waits for restoration before update suspension completes', async () => {
    const harness = await prepared({ settings: { muteWhileRecording: true } });
    const release = Promise.withResolvers<void>();
    const restoring = Promise.withResolvers<void>();
    const begin = harness.helper.beginRecordingAudio.bind(harness.helper);
    harness.helper.beginRecordingAudio = async (settings) => {
      const lease = await begin(settings);
      return { finish: async (options) => { restoring.resolve(); await release.promise; await lease.finish(options); } };
    };
    await pressAndSpeak(harness, 7);
    const microphone = new WindowAudioCapture(new FakeCaptureHost(), harness.logger);
    const guard = coordinatorDictationGuard({ coordinator: () => harness.coordinator, microphone, meter: microphone, logger: harness.logger });
    let suspended = false;
    const pause = guard.suspend().then((resume) => { suspended = true; return resume; });
    await restoring.promise;
    expect(suspended).toBe(false);
    expect(harness.capture.recording).toBe(false);
    release.resolve();
    const resume = await pause;
    expect(harness.helper.outputMuted).toBe(false);
    resume();
  });
  it('holds ordinary quit until recording restoration and terminally prevents new starts', async () => {
    const harness = await prepared({ settings: { muteWhileRecording: true, audioFeedback: true } });
    const restoring = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const begin = harness.helper.beginRecordingAudio.bind(harness.helper);
    harness.helper.beginRecordingAudio = async (settings) => {
      const lease = await begin(settings);
      return { finish: async (options) => {
        expect(harness.capture.recording).toBe(false);
        restoring.resolve();
        await release.promise;
        await lease.finish(options);
      } };
    };
    await pressAndSpeak(harness, 7);
    let quits = 0;
    const gate = new QuitGate({ isBusy: () => harness.coordinator.isBusy(), settled: () => harness.coordinator.shutdown() }, () => quits++, harness.logger);
    let prevented = false;
    gate.handle({ preventDefault: () => { prevented = true; } });
    await restoring.promise;
    expect(prevented).toBe(true);
    expect(quits).toBe(0);
    expect(harness.helper.outputMuted).toBe(true);
    release.resolve();
    await expect.poll(() => quits).toBe(1);
    expect(harness.helper.outputMuted).toBe(false);
    expect(harness.helper.audioTrace).toEqual(['start:default:50', 'mute', 'restore:false']);
    harness.helper.emitHotkey('up');
    harness.helper.emitHotkey('down');
    await harness.coordinator.shutdown();
    expect(harness.capture.starts).toHaveLength(1);
  });
  it('never opens the microphone after cancellation during pending audio acquisition', async () => {
    const harness = await prepared({ settings: { muteWhileRecording: true, audioFeedback: true } });
    const acquiring = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const begin = harness.helper.beginRecordingAudio.bind(harness.helper);
    harness.helper.beginRecordingAudio = async (settings) => {
      acquiring.resolve();
      await release.promise;
      return begin(settings);
    };
    harness.helper.emitHotkey('down');
    await acquiring.promise;
    harness.hotkey.cancel();
    release.resolve();
    await expect.poll(() => harness.helper.audioTrace).toEqual(['start:default:50', 'mute', 'restore:false']);
    expect(harness.capture.starts).toEqual([]);
    expect(harness.helper.outputMuted).toBe(false);
  });
  it('restores output and settles the stop cue before the next recording opens', async () => {
    const harness = await prepared({ settings: { muteWhileRecording: true, audioFeedback: true } });
    await pressAndSpeak(harness, 7);
    expect(harness.helper.outputMuted).toBe(true);
    harness.helper.emitHotkey('up');
    await pressAndSpeak(harness, 8);
    expect(harness.helper.audioTrace).toEqual(['start:default:50', 'mute', 'restore:false', 'stop:default:50', 'start:default:50', 'mute']);
    harness.helper.emitHotkey('up');
    await expect.poll(() => harness.helper.outputMuted).toBe(false);
    await expect.poll(() => harness.helper.pasted).toEqual(['7:32000', '8:32000']);
  });
  it('shows partial submit failure as delivered text without offering text reinsertion', async () => {
    const harness = await prepared({ settings: { insertion: 'type', autoSubmit: 'enter' } });
    harness.lastTranscript.set('Žilina 🚀', { appendTrailingSpace: true });
    harness.helper.submit = () => Promise.reject(new Error('submit timed out'));
    expect(await harness.coordinator.pasteLast()).toBe('delivered-submit-failed');
    expect(lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Text bol vložený. Odoslanie sa nepodarilo potvrdiť. Skontrolujte aplikáciu pred opakovaním.' });
    expect(harness.helper.typed).toEqual(['Žilina 🚀 ']);
    expect(harness.lastTranscript.get()).toBe('Žilina 🚀 ');
  });
  it('captures native vocabulary for an active local session and clears it on the next request', async () => {
    vi.stubEnv('CW_WORKER_CALLS', join(scratch, 'vocabulary-calls'));
    const harness = await prepared({ settings: { customWords: [{ word: 'Žilina', aliases: ['zilina'] }, { word: 'Kumiba MCP', aliases: ['kumiba em si pí'] }], appendTrailingSpace: true } });
    await pressAndSpeak(harness, 7);
    await harness.settings.update({ customWords: [{ word: 'Other', aliases: ['othr'] }], appendTrailingSpace: false });
    harness.helper.emitHotkey('up');
    await expect.poll(() => harness.helper.pasted).toEqual(['7:32000 ']);
    await dictate(harness, 8);
    await expect.poll(() => harness.helper.pasted).toEqual(['7:32000 ', '8:32000']);
    await harness.settings.update({ customWords: [] });
    await dictate(harness, 9);
    await expect.poll(() => harness.helper.pasted).toEqual(['7:32000 ', '8:32000', '9:32000']);
    const calls = (await readFile(join(scratch, 'vocabulary-calls'), 'utf8')).trim().split('\n').map((line): unknown => JSON.parse(line));
    expect(calls).toMatchObject([{ vocabulary: ['Žilina', 'Kumiba MCP'] }, { vocabulary: ['Other'] }, { vocabulary: [] }]);
  });
  it('records, transcribes and inserts', async () => {
    const harness = await prepared();

    await dictate(harness, 7);

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'inserted', appName: 'TextEdit' });
    const [first] = harness.states;
    expect(first).toEqual({ kind: 'recording', elapsedMs: expect.any(Number) as number, level: 0, languageChip: 'AUTO' });
    expect(first?.kind === 'recording' && first.elapsedMs < 100).toBe(true);
    expect(harness.states.some((state) => state.kind === 'recording' && state.level === 0.2)).toBe(true);
    expect(kinds(harness.states)).toEqual(['recording', 'processing', 'inserted']);
    expect(harness.lastTranscript.get()).toBe(ONE_SECOND_TEXT(7));
    expect(harness.helper.clipboard).toBe('original');
    expect(harness.capture.recording).toBe(false);
    expect(harness.capture.starts).toEqual([[]]);
    const [call] = await readRecordedCalls(argsFile);
    expect(call?.[call.indexOf('--language') + 1]).toBe('auto');
    await expect.poll(() => harness.states.at(-1), { timeout: 3000 }).toEqual({ kind: 'hidden' });
  });

  it('shows the fallback microphone notice', async () => {
    const harness = await prepared({ settings: { microphones: [{ deviceId: 'airpods-id', label: 'AirPods Pro' }] } });

    await dictate(harness, 3);

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(3)]);
    const recordings = harness.states.filter((state) => state.kind === 'recording');
    expect(recordings.at(-1)).toMatchObject({ fallbackDevice: 'AirPods Pro', level: 0.2 });
    expect(harness.capture.starts).toEqual([[{ deviceId: 'airpods-id', label: 'AirPods Pro' }]]);
  });

  it('shows the missing local model error with download and pairing actions and never switches to an unpaired server', async () => {
    const harness = await prepared({ settings: { localModelId: null } });

    await dictate(harness, 5);

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Lokálny model chýba', action: 'download-model', alternative: 'pair-server' });
    expect(harness.capture.recording).toBe(false);
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.lastTranscript.get()).toBeNull();
    await expect(readRecordedCalls(argsFile)).resolves.toEqual([]);

    harness.coordinator.act('download-model');
    harness.coordinator.act('pair-server');
    harness.coordinator.act('use-server');

    expect(harness.settingsOpened).toEqual(['local-model', 'server']);
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: MESSAGES.engineSwitchFailed, action: 'pair-server', alternative: 'download-model' });
    expect(harness.settings.get().engineOrder).toEqual(['local']);
  });

  it('sends selected languages without the local language pack to the Jazyky diktovania row', async () => {
    const harness = await prepared({ settings: { languages: { mode: 'selected', selected: ['sk', 'cs'] } } });

    await dictate(harness, 5);

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: MESSAGES.languagesPackMissing, action: 'open-languages' });
    await expect(readRecordedCalls(argsFile)).resolves.toEqual([]);
    harness.coordinator.act('open-languages');
    expect(harness.settingsOpened).toEqual(['languages']);
  });

  it('offers the ready local engine and pairing after a refused switch to an unpaired server', async () => {
    const harness = await prepared({ settings: { engineOrder: ['server'] } });

    harness.coordinator.act('use-server');

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: MESSAGES.engineSwitchFailed, action: 'use-local', alternative: 'pair-server' });
    expect(harness.settings.get().engineOrder).toEqual(['server']);
    harness.coordinator.act('use-local');
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'rerouted', engine: 'local' });
    expect(harness.settings.get().engineOrder).toEqual(['local']);
  });

  it('keeps the recovery actions for the current order when saving the switch fails', async () => {
    const harness = await prepared({ settings: { engineOrder: ['server'] } });
    await mkdir(join(scratch, 'settings.json.tmp'));

    harness.coordinator.act('use-local');

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: MESSAGES.engineSwitchFailed, action: 'use-local', alternative: 'pair-server' });
    expect(harness.settings.get().engineOrder).toEqual(['server']);
    expect(harness.logger.errors.map((entry) => entry.message)).toContain('The transcription engine could not be switched');
  });

  it('stops the microphone as soon as the model turns out to be broken', async () => {
    const harness = await prepared();
    await writeFile(join(harness.modelsDir, 'tiny.gguf'), 'XXXX');

    await pressAndSpeak(harness, 5);

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Model chýba alebo je poškodený', action: 'download-model' });
    expect(harness.capture.recording).toBe(false);
    harness.helper.emitHotkey('up');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(harness.helper.pasted).toEqual([]);
    await expect(readRecordedCalls(argsFile)).resolves.toEqual([]);
  });

  it('shows an error when the transcription program is missing', async () => {
    const harness = await prepared({ binary: join(scratch, 'missing-transcribe-cli') });

    await dictate(harness, 5);

    await expect.poll(() => lastVisible(harness.states)).toEqual({
      kind: 'error',
      message: 'Chýba program na prepis. Nainštalujte Codevo Whisper znova.',
    });
    expect(harness.helper.pasted).toEqual([]);
  });

  it('a new session while the previous one is transcribing keeps both results', async () => {
    vi.stubEnv('FAKE_CLI_DELAY_S', '0.4');
    const harness = await prepared();

    await dictate(harness, 7);
    await expect.poll(() => readRecordedCalls(argsFile)).toHaveLength(1);
    await dictate(harness, 9);

    await expect.poll(() => harness.helper.pasted, { timeout: 4000 }).toEqual([ONE_SECOND_TEXT(7), ONE_SECOND_TEXT(9)]);
    expect(harness.lastTranscript.get()).toBe(ONE_SECOND_TEXT(9));
    expect(await harness.history.view()).toMatchObject({ entries: [{ text: ONE_SECOND_TEXT(9) }, { text: ONE_SECOND_TEXT(7) }] });
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'inserted', appName: 'TextEdit' });
    const firstProcessing = harness.states.findIndex((state) => state.kind === 'processing');
    const secondStart = harness.states.findIndex((state, index) => index > firstProcessing && state.kind === 'recording');
    const secondProcessing = harness.states.findIndex((state, index) => index > secondStart && state.kind === 'processing');
    expect(harness.states.slice(secondStart, secondProcessing).every((state) => state.kind === 'recording')).toBe(true);
    expect(kinds(harness.states.slice(secondProcessing))).toEqual(['processing', 'inserted']);
  });

  it('anchors each recording end before waiting for the previous insertion pipeline', async () => {
    const pasteGate = Promise.withResolvers<void>();
    const pasteEntered = Promise.withResolvers<void>();
    class BlockedPasteHelper extends FakeInputHelper {
      override async paste(): Promise<void> {
        pasteEntered.resolve();
        await pasteGate.promise;
        await super.paste();
      }
    }
    vi.stubEnv('CW_WORKER_STARTS', join(scratch, 'starts'));
    let now = 0;
    const harness = await prepared({ inputHelper: new BlockedPasteHelper(), engineClock: { now: () => now }, settings: { localModelUnload: 2 } });
    await dictate(harness, 7);
    await pasteEntered.promise;
    now = 1000;
    await dictate(harness, 9);
    await expect.poll(() => readRecordedCalls(argsFile)).toHaveLength(2);
    expect(harness.helper.pasted).toEqual([]);
    now = 3 * 60_000;
    await harness.settings.update({ localModelUnload: 2 });
    pasteGate.resolve();
    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7), ONE_SECOND_TEXT(9)]);
    const rows = (await readFile(join(scratch, 'starts'), 'utf8')).trim().split('\n');
    const worker = JSON.parse(rows[0] ?? '{}') as { pid: number };
    await expect.poll(() => {
      try { process.kill(worker.pid, 0); return true; } catch { return false; }
    }).toBe(false);
  });

  it('does not store or count an already transcribed session cancelled while insertion is queued', async () => {
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    class BlockedPasteHelper extends FakeInputHelper {
      override async paste(): Promise<void> {
        entered.resolve();
        await gate.promise;
        await super.paste();
      }
    }
    const harness = await prepared({ inputHelper: new BlockedPasteHelper() });
    await dictate(harness, 7);
    await entered.promise;
    await dictate(harness, 9);
    await expect.poll(() => readRecordedCalls(argsFile)).toHaveLength(2);
    await expect.poll(() => harness.capture.recording).toBe(false);
    harness.coordinator.dispose();
    gate.resolve();
    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    await expect.poll(() => harness.coordinator.isDictating()).toBe(false);
    expect(harness.lastTranscript.get()).toBe(ONE_SECOND_TEXT(7));
    expect(await harness.stats.days()).toEqual([{ date: localDate(new Date()), words: 1, dictations: 1, seconds: 1 }]);
  });

  it('blocked insertion keeps the text as last transcript', async () => {
    const harness = await prepared();

    await pressAndSpeak(harness, 4);
    harness.helper.frontmostApp = NOTES;
    harness.helper.emitHotkey('up');

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'blocked', reason: 'focus' });
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.helper.clipboard).toBe('original');
    expect(harness.lastTranscript.get()).toBe(ONE_SECOND_TEXT(4));

    harness.coordinator.act('copy-last');

    await expect.poll(() => harness.helper.clipboard).toBe(ONE_SECOND_TEXT(4));
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'copied' });
    expect(await harness.history.view()).toMatchObject({ entries: [{ text: ONE_SECOND_TEXT(4) }] });
  });

  it('secure input blocks the paste and keeps the text', async () => {
    const harness = await prepared();

    await pressAndSpeak(harness, 4);
    harness.helper.secureInputEnabled = true;
    harness.helper.emitHotkey('up');

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'blocked', reason: 'secure' });
    expect(harness.lastTranscript.get()).toBe(ONE_SECOND_TEXT(4));
  });

  it('paste-last shortcut inserts the last transcript', async () => {
    const harness = await prepared();
    harness.helper.pressPasteLast();
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Zatiaľ nemáte žiadny prepis' });

    harness.lastTranscript.set('previous');
    harness.helper.pressPasteLast();

    await expect.poll(() => harness.helper.pasted).toEqual(['previous']);
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'inserted', appName: 'TextEdit' });
    await expect(harness.coordinator.pasteLast()).resolves.toBe('pasted');
    expect(harness.helper.pasted).toEqual(['previous', 'previous']);
  });

  it('copy-only outcomes say Skopírované and failures show an error', async () => {
    const harness = await prepared({ settings: { insertion: 'clipboard' } });

    await dictate(harness, 6);

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'copied' });
    expect(harness.helper.clipboard).toBe(ONE_SECOND_TEXT(6));
    await harness.settings.update({ insertion: 'paste' });
    harness.helper.clipboardWriteFails = true;

    await dictate(harness, 8);

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Text sa nepodarilo skopírovať do schránky' });
    expect(harness.lastTranscript.get()).toBe(ONE_SECOND_TEXT(8));
  });

  it('discards the audio on lock, suspend, lost input and pause', async () => {
    let totalStarts = 0;
    for (const reason of ['lock', 'suspend', 'helper-died', 'pause'] as const) {
      const harness = await prepared();
      await pressAndSpeak(harness, 2);
      if (reason === 'lock') harness.power.emit('lock-screen');
      if (reason === 'suspend') harness.power.emit('suspend');
      if (reason === 'helper-died') harness.helper.loseInput('helper-died');
      if (reason === 'pause') harness.coordinator.pause();
      await expect.poll(() => harness.capture.recording).toBe(false);
      await expect.poll(() => harness.states.at(-1)).toEqual({ kind: 'hidden' });
      harness.helper.emitHotkey('up');
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(harness.helper.pasted).toEqual([]);
      expect(harness.lastTranscript.get()).toBeNull();
      await expect(readRecordedCalls(argsFile)).resolves.toEqual([]);
      expect(await harness.stats.days()).toEqual([]);
      if (reason === 'pause') {
        expect(harness.coordinator.isPaused()).toBe(true);
        harness.helper.emitHotkey('down');
      }
      expect(harness.capture.starts).toHaveLength(1);
      totalStarts += harness.capture.starts.length;
      harness.coordinator.dispose();
      harness.hotkey.dispose();
    }
    expect(totalStarts).toBe(4);
  });

  it('the 10 minute limit stops the session and transcribes what was recorded', async () => {
    const harness = await prepared();

    await pressAndSpeak(harness, 5);
    harness.capture.reachLimit();

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(5)]);
    expect(harness.states).toContainEqual({ kind: 'processing', notice: 'limit-reached' });
    harness.helper.emitHotkey('up');
    harness.helper.emitHotkey('down');
    await expect.poll(() => harness.capture.starts).toHaveLength(2);
  });

  it('reports a microphone that cannot start and inserts nothing', async () => {
    const harness = await prepared();
    harness.capture.failNextStart = true;

    harness.helper.emitHotkey('down');
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Mikrofón sa nepodarilo zapnúť' });
    harness.helper.emitHotkey('up');

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Mikrofón sa nepodarilo zapnúť' });
    await expect(readRecordedCalls(argsFile)).resolves.toEqual([]);
    expect(harness.capture.frameSubscribers).toBe(0);
  });

  it('stops listening for recording frames once a dictation ends', async () => {
    const harness = await prepared();

    await dictate(harness, 5);

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(5)]);
    expect(harness.capture.frameSubscribers).toBe(0);
  });

  it('reports a microphone failure that arrives after the key was released', async () => {
    const harness = await prepared();
    harness.capture.failNextStart = true;
    harness.capture.failureDelayMs = 100;

    harness.helper.emitHotkey('down');
    harness.helper.emitHotkey('up');

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Mikrofón sa nepodarilo zapnúť' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Mikrofón sa nepodarilo zapnúť' });
    await expect(readRecordedCalls(argsFile)).resolves.toEqual([]);
  });

  it('reports a failed transcription and silence without inserting', async () => {
    const harness = await prepared();

    harness.helper.emitHotkey('down');
    await expect.poll(() => harness.capture.recording).toBe(true);
    harness.helper.emitHotkey('up');
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Nezachytila sa žiadna reč' });

    await setWorkerMode('fail');
    await dictate(harness, 3);

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Prepis sa nepodaril', action: 'retry' });
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.lastTranscript.get()).toBeNull();
  });

  it.each(['darwin', 'linux'] as const)('records stats after a successful dictation and not after an empty or failed one on %s', async (platform) => {
    const harness = await prepared({ platform });

    harness.helper.emitHotkey('down');
    await expect.poll(() => harness.capture.recording).toBe(true);
    harness.helper.emitHotkey('up');
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Nezachytila sa žiadna reč' });
    await setWorkerMode('fail');
    await dictate(harness, 3);
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Prepis sa nepodaril', action: 'retry' });
    expect(await harness.stats.days()).toEqual([]);
    expect(await harness.history.view()).toMatchObject({ entries: [] });

    await setWorkerMode('echo-chunk');
    await dictate(harness, 7);
    await expect.poll(() => harness.helper.pasted, { timeout: 5000 }).toEqual([ONE_SECOND_TEXT(7)]);
    const today = localDate(new Date());
    await expect.poll(() => harness.stats.days()).toEqual([{ date: today, words: 1, dictations: 1, seconds: 1 }]);

    await pressAndSpeak(harness, 4);
    harness.helper.frontmostApp = NOTES;
    harness.helper.emitHotkey('up');
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'blocked', reason: 'focus' });
    await expect.poll(() => harness.stats.days()).toEqual([{ date: today, words: 2, dictations: 2, seconds: 2 }]);
  });

  it('does not record punctuation-only text as a dictation', async () => {
    await setWorkerMode('text');
    vi.stubEnv('FAKE_CLI_TEXT', '- …');
    const harness = await prepared();

    await dictate(harness, 2);

    await expect.poll(() => harness.helper.pasted).toEqual(['- …']);
    expect(harness.lastTranscript.get()).toBe('- …');
    expect(await harness.history.view()).toMatchObject({ entries: [{ text: '- …' }] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await harness.stats.days()).toEqual([]);
  });

  it('inserts, stores and counts only the sanitized transcript', async () => {
    await setWorkerMode('text');
    vi.stubEnv('FAKE_CLI_TEXT', 'ahoj\n\u001b[201~svet\u202e\u200b');
    const harness = await prepared();

    await dictate(harness, 2);

    await expect.poll(() => harness.helper.pasted).toEqual(['ahoj [201~svet']);
    expect(harness.lastTranscript.get()).toBe('ahoj [201~svet');
    expect(await harness.history.view()).toMatchObject({ entries: [{ text: 'ahoj [201~svet' }] });
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'inserted', appName: 'TextEdit' });
  });

  it('inserts, remembers and stores the AI-polished text when polish is on', async () => {
    const received: string[] = [];
    const harness = await prepared({
      settings: { aiPolish: true, aiBaseUrl: 'http://127.0.0.1:11434/v1', aiModel: 'qwen2.5:1.5b', appendTrailingSpace: true },
      polish: ({ text }) => {
        received.push(text);
        return Promise.resolve({ text: 'Upravený\u202e text.', failure: null });
      },
    });

    await dictate(harness, 7);

    await expect.poll(() => harness.helper.pasted).toEqual(['Upravený text. ']);
    expect(received).toEqual([ONE_SECOND_TEXT(7)]);
    expect(harness.lastTranscript.get()).toBe('Upravený text. ');
    expect(await harness.history.view()).toMatchObject({ entries: [{ text: 'Upravený text. ' }] });
    expect(kinds(harness.states)).toEqual(['recording', 'processing', 'inserted']);
  });

  it('sends the preferred spellings and the text around the captured cursor to the polish, never the aliases', async () => {
    const received: PolishRequest[] = [];
    const harness = await prepared({
      settings: { ...AI_SERVER, aiPolish: true, customWords: [{ word: 'Kumiba', aliases: ['kumíba', 'kumyba'] }, { word: 'Codevo', aliases: [] }] },
      polish: (request) => {
        received.push(request);
        return Promise.resolve({ text: 'Upravený text.', failure: null });
      },
    });
    harness.helper.fieldContext = { before: 'Ahoj Peter, ', after: ' S pozdravom' };

    await dictate(harness, 7);

    await expect.poll(() => harness.helper.pasted).toEqual(['Upravený text.']);
    expect(received).toEqual([{ text: ONE_SECOND_TEXT(7), words: ['Kumiba', 'Codevo'], context: { before: 'Ahoj Peter, ', after: ' S pozdravom' } }]);
    expect(harness.helper.contextReads).toEqual(['capture-1']);
  });

  it('polishes without context when no target was captured', async () => {
    const received: PolishRequest[] = [];
    const harness = await prepared({ settings: { ...AI_SERVER, aiPolish: true }, helper: { frontmost: null }, polish: (request) => { received.push(request); return Promise.resolve({ text: 'Upravený text.', failure: null }); } });
    harness.helper.fieldContext = { before: 'Ahoj Peter, ', after: ' S pozdravom' };

    await dictate(harness, 7);

    await expect.poll(() => received).toHaveLength(1);
    expect(received[0]?.context).toBeNull();
    expect(harness.helper.contextReads).toEqual([]);
  });

  it('polishes without context when the text around the cursor cannot be read, without logging it', async () => {
    const received: PolishRequest[] = [];
    const harness = await prepared({ settings: { ...AI_SERVER, aiPolish: true }, polish: (request) => { received.push(request); return Promise.resolve({ text: 'Upravený text.', failure: null }); } });
    harness.helper.fieldContext = { before: 'Ahoj Peter, ', after: ' S pozdravom' };
    vi.spyOn(harness.helper, 'targetContext').mockRejectedValue(new Error('helper-error:target-context'));

    await dictate(harness, 7);

    await expect.poll(() => harness.helper.pasted).toEqual(['Upravený text.']);
    expect(received[0]?.context).toBeNull();
    expect(harness.logger.errors.map(({ message }) => message)).toContain('The text around the cursor could not be read');
    const logged = JSON.stringify([...harness.logger.infos, ...harness.logger.warns, ...harness.logger.errors.map(({ message, error }) => ({ message, error: String(error) }))]);
    expect(logged).not.toContain('Ahoj Peter');
    expect(logged).not.toContain('pozdravom');
  });

  it('polishes through Codex CLI without a server address once the user picks it', async () => {
    const harness = await prepared({
      settings: { aiPolish: true, aiProvider: 'codex', aiBaseUrl: null, aiModel: '' },
      polish: () => Promise.resolve({ text: 'Upravené cez Codex.', failure: null }),
    });

    await dictate(harness, 7);

    await expect.poll(() => harness.helper.pasted).toEqual(['Upravené cez Codex.']);
  });

  it.each([
    ['codex-not-found', 'Codex CLI sa nenašiel. Nainštalujte ho alebo skontrolujte PATH.'],
    ['codex-logged-out', 'Codex CLI nie je prihlásený. Spustite `codex login`.'],
  ] as const)('inserts the raw text and tells the user why Codex CLI did not polish it (%s)', async (failure, notice) => {
    const harness = await prepared({
      settings: { aiPolish: true, aiProvider: 'codex', aiBaseUrl: null, aiModel: '' },
      polish: ({ text }) => Promise.resolve({ text, failure }),
    });

    await dictate(harness, 7);

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'inserted', appName: 'TextEdit', notice });
  });

  it('tells the user why Codex CLI did not polish a dictation copied to the clipboard', async () => {
    const harness = await prepared({
      settings: { insertion: 'clipboard', aiPolish: true, aiProvider: 'codex', aiBaseUrl: null, aiModel: '' },
      polish: ({ text }) => Promise.resolve({ text, failure: 'codex-logged-out' }),
    });

    await dictate(harness, 7);

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'copied', notice: 'Codex CLI nie je prihlásený. Spustite `codex login`.' });
  });

  it.each([
    ['polish is off', { aiPolish: false, aiBaseUrl: 'http://127.0.0.1:11434/v1', aiModel: 'qwen2.5:1.5b' }],
    ['polish is off with Codex chosen', { aiPolish: false, aiProvider: 'codex' as const }],
    ['no model is chosen', { aiPolish: true, aiBaseUrl: 'http://127.0.0.1:11434/v1', aiModel: '' }],
    ['no endpoint is set', { aiPolish: true, aiBaseUrl: null, aiModel: 'qwen2.5:1.5b' }],
  ])('never calls the AI when %s', async (_case, settings) => {
    let calls = 0;
    const harness = await prepared({ settings, polish: ({ text }) => { calls++; return Promise.resolve({ text, failure: null }); } });

    await dictate(harness, 7);

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    expect(calls).toBe(0);
    expect(harness.helper.contextReads).toEqual([]);
  });

  it('cancels the AI request and inserts nothing when the app shuts down during polish', async () => {
    const aborted = Promise.withResolvers<void>();
    let calls = 0;
    const harness = await prepared({
      settings: { aiPolish: true, aiBaseUrl: 'http://127.0.0.1:11434/v1', aiModel: 'qwen2.5:1.5b' },
      polish: ({ text }, signal) => {
        calls++;
        return new Promise((resolve) => signal.addEventListener('abort', () => { aborted.resolve(); resolve({ text, failure: 'aborted' }); }));
      },
    });

    await dictate(harness, 7);
    await expect.poll(() => calls).toBe(1);
    await harness.coordinator.shutdown();
    await aborted.promise;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(harness.helper.pasted).toEqual([]);
    expect(harness.lastTranscript.get()).toBeNull();
    expect(await harness.history.view()).toMatchObject({ entries: [] });
  });

  it('arms in-dictation shortcuts only while a session is active', async () => {
    const harness = await prepared();
    expect(harness.helper.sessionShortcuts).toEqual([]);

    await dictate(harness, 7);
    expect(harness.helper.sessionShortcuts).toEqual([
      { action: 'cancel', key: 'escape', modifiers: [] },
      { action: 'lock-target', key: 'l', modifiers: ['control', 'shift'] },
      { action: 'cycle-language', key: 'j', modifiers: ['control', 'alt'] },
    ]);

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    await expect.poll(() => harness.helper.sessionShortcuts).toEqual([]);
  });

  it('arms the AI toggle and the shortcuts saved in Settings when AI polish is configured', async () => {
    const harness = await prepared({ settings: { ...AI_SERVER, sessionShortcuts: { 'toggle-polish': { key: 'p', modifiers: ['meta'] }, 'cycle-language': { key: 'f2', modifiers: ['shift'] } } } });

    await pressAndSpeak(harness, 7);

    expect(harness.helper.sessionShortcuts).toEqual([
      { action: 'cancel', key: 'escape', modifiers: [] },
      { action: 'lock-target', key: 'l', modifiers: ['control', 'shift'] },
      { action: 'toggle-polish', key: 'p', modifiers: ['meta'] },
      { action: 'cycle-language', key: 'f2', modifiers: ['shift'] },
    ]);
  });

  it('re-arms the in-dictation shortcuts when the dictation hotkey changes while a dictation is processing', async () => {
    vi.stubEnv('CW_WORKER_DELAY_MS', '1500');
    const harness = await prepared({ settings: AI_SERVER });
    await dictate(harness, 7);
    await expect.poll(() => kinds(harness.states).at(-1)).toBe('processing');
    expect(harness.helper.sessionShortcuts.map(({ action }) => action)).toEqual(['cancel', 'lock-target', 'toggle-polish', 'cycle-language']);

    await harness.settings.update({ hotkey: { kind: 'key', keycode: 0x10000 + 30 + 8, modifiers: ['control', 'alt'], label: 'Ctrl+Alt+A' } });

    expect(harness.helper.sessionShortcuts.map(({ action }) => action)).toEqual(['cancel', 'lock-target', 'cycle-language']);
    await expect.poll(() => harness.helper.pasted, { timeout: 4000 }).toEqual([ONE_SECOND_TEXT(7)]);
  });

  it.each([
    ['the shortcut', (harness: Harness) => harness.helper.pressSessionShortcut('toggle-polish')],
    ['the AI chip', (harness: Harness) => harness.coordinator.act('toggle-polish')],
  ])('turns AI polish on for one dictation with %s without changing the setting', async (_via, toggle) => {
    const received: string[] = [];
    const harness = await prepared({ settings: { ...AI_SERVER, aiPolish: false }, polish: ({ text }) => { received.push(text); return Promise.resolve({ text: 'Upravený text.', failure: null }); } });

    await pressAndSpeak(harness, 7);
    expect(lastVisible(harness.states)).toMatchObject({ kind: 'recording', polish: false });
    toggle(harness);
    expect(lastVisible(harness.states)).toMatchObject({ kind: 'recording', polish: true });
    harness.helper.emitHotkey('up');

    await expect.poll(() => harness.helper.pasted).toEqual(['Upravený text.']);
    expect(received).toEqual([ONE_SECOND_TEXT(7)]);
    expect(harness.settings.get().aiPolish).toBe(false);

    await dictate(harness, 8);
    await expect.poll(() => harness.helper.pasted).toEqual(['Upravený text.', ONE_SECOND_TEXT(8)]);
    expect(received).toHaveLength(1);
  });

  it('turns AI polish off for one dictation while it is transcribing', async () => {
    let calls = 0;
    vi.stubEnv('CW_WORKER_DELAY_MS', '600');
    const harness = await prepared({ settings: { ...AI_SERVER, aiPolish: true }, polish: () => { calls++; return Promise.resolve({ text: 'Upravený text.', failure: null }); } });

    await dictate(harness, 7);
    await expect.poll(() => lastVisible(harness.states)).toMatchObject({ kind: 'processing', polish: true });
    harness.helper.pressSessionShortcut('toggle-polish');
    expect(lastVisible(harness.states)).toMatchObject({ kind: 'processing', polish: false });

    await expect.poll(() => harness.helper.pasted, { timeout: 3000 }).toEqual([ONE_SECOND_TEXT(7)]);
    expect(calls).toBe(0);
    expect(harness.settings.get().aiPolish).toBe(true);
  });

  it('stops a running AI request when the chip is turned off and inserts the unpolished text without a notice', async () => {
    const aborted = Promise.withResolvers<void>();
    let calls = 0;
    const harness = await prepared({
      settings: { ...AI_SERVER, aiPolish: true },
      polish: ({ text }, signal) => {
        calls++;
        return new Promise((resolve) => signal.addEventListener('abort', () => { aborted.resolve(); resolve({ text, failure: 'aborted' }); }));
      },
    });

    await dictate(harness, 7);
    await expect.poll(() => calls).toBe(1);
    harness.coordinator.act('toggle-polish');
    await aborted.promise;

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    expect(lastVisible(harness.states)).toEqual({ kind: 'inserted', appName: 'TextEdit' });
  });

  it('polishes again with the same context, read once, when the chip is turned back on before the text is delivered', async () => {
    const received: PolishRequest[] = [];
    const harness = await prepared({
      settings: { ...AI_SERVER, aiPolish: true },
      polish: (request, signal) => {
        received.push(request);
        if (received.length > 1) return Promise.resolve({ text: 'Upravený text.', failure: null });
        return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ text: request.text, failure: 'aborted' })));
      },
    });
    harness.helper.fieldContext = { before: 'Ahoj Peter, ', after: ' S pozdravom' };

    await dictate(harness, 7);
    await expect.poll(() => received).toHaveLength(1);
    harness.coordinator.act('toggle-polish');
    harness.coordinator.act('toggle-polish');

    await expect.poll(() => harness.helper.pasted).toEqual(['Upravený text.']);
    expect(received.map(({ context }) => context)).toEqual([{ before: 'Ahoj Peter, ', after: ' S pozdravom' }, { before: 'Ahoj Peter, ', after: ' S pozdravom' }]);
    expect(harness.helper.contextReads).toEqual(['capture-1']);
  });

  it('shows no AI chip and ignores the toggle when AI polish is not configured', async () => {
    let calls = 0;
    const harness = await prepared({ polish: ({ text }) => { calls++; return Promise.resolve({ text, failure: null }); } });

    await pressAndSpeak(harness, 7);
    harness.coordinator.act('toggle-polish');
    harness.helper.emitHotkey('up');

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    expect(calls).toBe(0);
    expect(harness.states.some((state) => 'polish' in state)).toBe(false);
  });

  it('cycles AUTO and each selected language and transcribes the whole recording in the chosen one', async () => {
    const harness = await prepared({ languageHint: 'required', settings: { languages: { mode: 'selected', selected: ['sk', 'cs'] } } });

    await pressAndSpeak(harness, 7);
    expect(lastVisible(harness.states)).toMatchObject({ kind: 'recording', languageChip: 'SK +1' });
    const chips = ['cycle-language', 'cycle-language', 'cycle-language', 'cycle-language'].map(() => {
      harness.helper.pressSessionShortcut('cycle-language');
      return (lastVisible(harness.states) as { languageChip?: string }).languageChip;
    });
    expect(chips).toEqual(['AUTO', 'SK', 'CS', 'AUTO']);
    harness.coordinator.act('cycle-language');
    harness.coordinator.act('cycle-language');
    harness.helper.emitHotkey('up');

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    const calls = await readRecordedCalls(argsFile);
    expect(calls.at(-1)?.[calls.at(-1)!.indexOf('--language') + 1]).toBe('cs');
    expect(harness.settings.get().languages).toEqual({ mode: 'selected', selected: ['sk', 'cs'] });
  });

  it('cleans up the final text in the chosen language, not the starting one', async () => {
    await setWorkerMode('text');
    vi.stubEnv('FAKE_CLI_TEXT', 'Es geht um das Haus.');
    const harness = await prepared({ languageHint: 'required', settings: { removeFillerWords: true, languages: { mode: 'selected', selected: ['en', 'de'] } } });

    await pressAndSpeak(harness, 7);
    harness.coordinator.act('cycle-language');
    harness.coordinator.act('cycle-language');
    harness.coordinator.act('cycle-language');
    expect(lastVisible(harness.states)).toMatchObject({ kind: 'recording', languageChip: 'DE' });
    harness.helper.emitHotkey('up');

    await expect.poll(() => harness.helper.pasted).toEqual(['Es geht um das Haus.']);
  });

  it('keeps the streaming transcription when the language is cycled back to where it started', async () => {
    const harness = await prepared({ languageHint: 'required', settings: { languages: { mode: 'selected', selected: ['sk'] } } });

    await pressAndSpeak(harness, 7);
    harness.coordinator.act('cycle-language');
    expect(lastVisible(harness.states)).toMatchObject({ kind: 'recording', languageChip: 'AUTO' });
    harness.coordinator.act('cycle-language');
    harness.helper.emitHotkey('up');

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    const languages = (await readRecordedCalls(argsFile)).map((call) => call[call.indexOf('--language') + 1]);
    expect(languages).toEqual(['sk']);
  });

  it('hides live words in the starting language while another language is chosen', async () => {
    const samples = timelineSpeech(4);
    await useTimeline(samples);
    let now = 0;
    const harness = await prepared({ binary: FAKE_TIMELINE_CLI, languageHint: 'required', settings: { overlay: 'live', languages: { mode: 'selected', selected: ['sk'] } }, engineClock: { now: () => now } });

    await speakTimeline(harness, samples, () => {
      now += 1000;
    });
    await expect.poll(() => (lastVisible(harness.states) as { live?: LiveText }).live?.tentative ?? '').not.toBe('');
    harness.coordinator.act('cycle-language');
    expect(lastVisible(harness.states)).toMatchObject({ kind: 'recording', languageChip: 'AUTO', live: { confirmed: '', tentative: '' } });
    harness.coordinator.act('cycle-language');

    expect(lastVisible(harness.states)).toMatchObject({ kind: 'recording', languageChip: 'SK' });
    expect((lastVisible(harness.states) as { live?: LiveText }).live?.tentative).not.toBe('');
  });

  it('fixes the language once recording stops', async () => {
    await setWorkerMode('hang');
    const harness = await prepared({ languageHint: 'required', settings: { languages: { mode: 'selected', selected: ['sk', 'cs'] } } });

    await dictate(harness, 7);
    await expect.poll(() => kinds(harness.states).at(-1)).toBe('processing');
    const before = harness.states.length;
    harness.helper.pressSessionShortcut('cycle-language');

    expect(harness.states.slice(before).some((state) => state.kind === 'recording')).toBe(false);
  });

  it.each(['escape', 'overlay button'] as const)('discards a recording on %s without inserting, copying or remembering', async (via) => {
    const harness = await prepared({ settings: { mode: 'toggle' } });
    harness.helper.emitHotkey('down');
    await expect.poll(() => harness.capture.starts.length).toBe(1);
    harness.capture.speak(stampedPcm(7));

    cancelVia(harness, via);

    await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
    expect(harness.capture.recording).toBe(false);
    expect(harness.states.at(-1)).toEqual({ kind: 'hidden' });
    expect(harness.helper.sessionShortcuts).toEqual([]);
    harness.helper.emitHotkey('down');
    await expect.poll(() => harness.capture.starts.length).toBe(2);
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.helper.clipboard).toBe('original');
    expect(harness.lastTranscript.get()).toBeNull();
    expect(await harness.history.view()).toMatchObject({ entries: [] });
    expect(await harness.stats.days()).toEqual([]);
  });

  it.each(['escape', 'overlay button'] as const)('abandons an in-flight transcription on %s', async (via) => {
    await setWorkerMode('hang');
    const harness = await prepared();
    await dictate(harness, 7);
    await expect.poll(() => kinds(harness.states).at(-1)).toBe('processing');

    cancelVia(harness, via);

    await expect.poll(() => harness.coordinator.isBusy(), { timeout: 3000 }).toBe(false);
    expect(harness.states.at(-1)).toEqual({ kind: 'hidden' });
    expect(harness.helper.sessionShortcuts).toEqual([]);
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.helper.clipboard).toBe('original');
    expect(harness.lastTranscript.get()).toBeNull();
    expect(await harness.history.view()).toMatchObject({ entries: [] });
    expect(await harness.stats.days()).toEqual([]);
  });

  it('aborts AI polish and inserts nothing when the user cancels', async () => {
    const aborted = Promise.withResolvers<void>();
    let calls = 0;
    const harness = await prepared({
      settings: { aiPolish: true, aiBaseUrl: 'http://127.0.0.1:11434/v1', aiModel: 'qwen2.5:1.5b' },
      polish: ({ text }, signal) => {
        calls++;
        return new Promise((resolve) => signal.addEventListener('abort', () => { aborted.resolve(); resolve({ text, failure: 'aborted' }); }));
      },
    });

    await dictate(harness, 7);
    await expect.poll(() => calls).toBe(1);
    harness.helper.pressSessionShortcut('cancel');
    await aborted.promise;
    await expect.poll(() => harness.coordinator.isBusy()).toBe(false);

    expect(harness.states.at(-1)).toEqual({ kind: 'hidden' });
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.lastTranscript.get()).toBeNull();
    expect(await harness.history.view()).toMatchObject({ entries: [] });
  });

  it('retires the session and releases Esc at once when cancelled while engine preparation is pending', async () => {
    const harness = await prepared();
    await harness.coordinator.shutdown();
    const readiness = Promise.withResolvers<Preparation>();
    const pending = new SessionCoordinator({
      hotkey: harness.hotkey, capture: harness.capture,
      engines: { prepare: () => readiness.promise },
      routing: { capabilities: () => Promise.resolve({ localReady: false, serverReady: false, serverOffline: false, serverOff: false, serverRepair: false }), prefer: () => Promise.reject(new Error('unused')) },
      insertion: new InsertionService(harness.helper, harness.settings, harness.lastTranscript),
      lastTranscript: harness.lastTranscript, helper: harness.helper,
      settings: harness.settings, stats: harness.stats, history: harness.history,
      pause: harness.pause, overlay: (state) => harness.states.push(state), logger: harness.logger,
    });
    coordinator = pending;
    pending.start();
    await dictate(harness, 7);
    await pending.settled();
    expect(harness.states.at(-1)?.kind).toBe('processing');

    harness.helper.pressSessionShortcut('cancel');

    expect({ busy: pending.isBusy(), shortcuts: harness.helper.sessionShortcuts, overlay: harness.states.at(-1)?.kind }).toEqual({ busy: false, shortcuts: [], overlay: 'hidden' });
    readiness.resolve({ ready: false });
    await pending.settled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(harness.states.at(-1)).toEqual({ kind: 'hidden' });
  });

  it('never delivers when the cancel arrives between transcription and the delivery boundary', async () => {
    let cancel: () => void = () => undefined;
    const harness = await prepared({
      settings: { aiPolish: true, aiBaseUrl: 'http://127.0.0.1:11434/v1', aiModel: 'qwen2.5:1.5b' },
      polish: ({ text }) => { cancel(); return Promise.resolve({ text, failure: null }); },
    });
    cancel = () => harness.helper.pressSessionShortcut('cancel');
    await dictate(harness, 7);
    await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(harness.helper.pasted).toEqual([]);
    expect(harness.helper.clipboard).toBe('original');
    expect(harness.lastTranscript.get()).toBeNull();
    expect(await harness.history.view()).toMatchObject({ entries: [] });
    expect(harness.states.at(-1)).toEqual({ kind: 'hidden' });
  });

  it('stops offering cancel once the final text is ready and delivers it', async () => {
    const checking = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    class SlowCheck extends FakeInputHelper {
      override async checkDelivery() {
        checking.resolve();
        await resume.promise;
        return { kind: 'legacy' as const };
      }
    }
    const helper = new SlowCheck({ clipboard: 'original' });
    const harness = await prepared({ inputHelper: helper });
    await dictate(harness, 7);
    await checking.promise;

    expect(helper.sessionShortcuts).toEqual([]);
    const shown = harness.states.at(-1);
    expect(shown?.kind === 'processing' && offeredActions(shown)).toEqual([]);
    helper.pressSessionShortcut('cancel');
    harness.coordinator.act('cancel');
    resume.resolve();

    await expect.poll(() => helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'inserted', appName: 'TextEdit' });
    expect(harness.lastTranscript.get()).toBe(ONE_SECOND_TEXT(7));
    expect(await harness.history.view()).toMatchObject({ entries: [expect.objectContaining({ text: ONE_SECOND_TEXT(7) })] });
  });

  it('ignores a cancel shortcut that arrives with no active session', async () => {
    const harness = await prepared();
    harness.helper.pressSessionShortcut('cancel');
    harness.coordinator.act('cancel');
    await dictate(harness, 7);
    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
  });

  it('treats a transcript with only control and invisible characters as silence', async () => {
    await setWorkerMode('text');
    vi.stubEnv('FAKE_CLI_TEXT', '\u001b\u200b\u202e\u0007\u2028');
    const harness = await prepared();

    await dictate(harness, 2);

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Nezachytila sa žiadna reč' });
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.lastTranscript.get()).toBeNull();
    expect(await harness.stats.days()).toEqual([]);
  });

  it('keeps the last transcript and inserts when the statistics cannot be saved', async () => {
    await mkdir(join(scratch, 'stats.json'));
    const harness = await prepared();
    const announced: string[] = [];
    harness.lastTranscript.onChange((text) => announced.push(text));

    await dictate(harness, 7);

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    expect(announced).toEqual([ONE_SECOND_TEXT(7)]);
    await expect.poll(() => harness.logger.errors.map((entry) => entry.message)).toContain('The dictation statistics could not be saved');
    expect(await harness.history.view()).toMatchObject({ entries: [{ text: ONE_SECOND_TEXT(7) }] });
  });

  it('keeps insertion and aggregate stats independent of history persistence failure', async () => {
    const harness = await prepared();
    await rm(join(scratch, 'history.json'));
    await mkdir(join(scratch, 'history.json'));
    await dictate(harness, 7);
    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    await expect.poll(() => harness.stats.days()).toMatchObject([{ words: 1, dictations: 1 }]);
    expect(await harness.history.view()).toMatchObject({ entries: [], writeError: true });
    expect(harness.lastTranscript.get()).toBe(ONE_SECOND_TEXT(7));
    expect(harness.logger.errors.filter((entry) => entry.message === 'The completed transcript could not be saved to history')).toEqual([{ message: 'The completed transcript could not be saved to history', error: undefined }]);
  });

  it('uses consent at completion and never records utility copies, re-pastes or backfills', async () => {
    const harness = await prepared();
    await harness.history.configure({ enabled: false, limit: 10 });
    await dictate(harness, 1);
    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(1)]);
    expect(await harness.history.view()).toMatchObject({ entries: [] });
    await pressAndSpeak(harness, 2);
    await harness.history.configure({ enabled: true, limit: 10 });
    harness.helper.emitHotkey('up');
    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(1), ONE_SECOND_TEXT(2)]);
    await harness.coordinator.copyLast();
    await harness.coordinator.pasteLast();
    harness.lastTranscript.set('direct memory update');
    expect(await harness.history.view()).toMatchObject({ entries: [{ text: ONE_SECOND_TEXT(2) }] });
    const days = await harness.stats.days();
    const raw = await readFile(join(scratch, 'stats.json'), 'utf8');
    await harness.history.clear();
    expect(await harness.stats.days()).toEqual(days);
    expect(await readFile(join(scratch, 'stats.json'), 'utf8')).toBe(raw);
    expect(harness.lastTranscript.get()).toBe('direct memory update');
  });

  it('pausing and resuming updates the shared pause state', async () => {
    const harness = await prepared();
    const changes: boolean[] = [];
    harness.pause.onChange((paused) => changes.push(paused));

    harness.coordinator.pause();
    harness.coordinator.pause();
    harness.coordinator.resume();

    expect(changes).toEqual([true, false]);
    expect(harness.coordinator.isPaused()).toBe(false);
    expect(harness.pause.isPaused()).toBe(false);
  });

  it('reports a dictation as active from the key press until the text is inserted', async () => {
    vi.stubEnv('FAKE_CLI_DELAY_S', '0.4');
    const harness = await prepared();
    expect(harness.coordinator.isDictating()).toBe(false);

    await pressAndSpeak(harness, 7);
    expect(harness.coordinator.isDictating()).toBe(true);
    harness.helper.emitHotkey('up');
    await expect.poll(() => readRecordedCalls(argsFile)).toHaveLength(1);
    expect(harness.coordinator.isDictating()).toBe(true);

    await expect.poll(() => harness.helper.pasted, { timeout: 3000 }).toEqual([ONE_SECOND_TEXT(7)]);
    await expect.poll(() => harness.coordinator.isDictating()).toBe(false);
  });

  it('the update guard pauses dictation, stops the meter and lets the microphone settle before the install', async () => {
    const harness = await prepared();
    const host = new FakeCaptureHost();
    const microphone = new WindowAudioCapture(host, harness.logger);
    await microphone.startMeter([]);
    const guard = coordinatorDictationGuard({ coordinator: () => harness.coordinator, microphone, meter: microphone, logger: harness.logger });

    const release = await guard.suspend();

    expect(harness.coordinator.isPaused()).toBe(true);
    expect(host.requests.at(-1)).toEqual({ type: 'stop' });
    expect(microphone.isBusy()).toBe(false);
    await expect(microphone.startMeter([])).rejects.toThrow('The microphone is closed for an app update');
    harness.helper.emitHotkey('down');
    expect(guard.isDictating()).toBe(false);
    release();

    expect(harness.coordinator.isPaused()).toBe(false);
    await expect(microphone.startMeter([])).resolves.toBeUndefined();
  });

  it('the update guard keeps a pause the user chose', async () => {
    const harness = await prepared();
    const microphone = new WindowAudioCapture(new FakeCaptureHost(), harness.logger);
    const guard = coordinatorDictationGuard({ coordinator: () => harness.coordinator, microphone, meter: microphone, logger: harness.logger });
    harness.coordinator.pause();

    (await guard.suspend())();

    expect(harness.coordinator.isPaused()).toBe(true);
  });

  it.each([299, 300])('smart %i ms gesture completes normal transcription', async (duration) => {
    const harness = await prepared({ settings: { mode: 'smart' } });
    harness.helper.emitHotkey('down', 0);
    await expect.poll(() => harness.capture.recording).toBe(true);
    harness.capture.speak(stampedPcm(6));
    harness.helper.emitHotkey('up', duration);
    if (duration === 299) {
      expect(harness.capture.recording).toBe(true);
      harness.helper.emitHotkey('down', 1_000);
      harness.helper.emitHotkey('up', 1_300);
    }

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(6)]);
    expect(kinds(harness.states)).toEqual(['recording', 'processing', 'inserted']);
  });

  it('toggle mode records until the second press and then inserts', async () => {
    const harness = await prepared({ settings: { mode: 'toggle' } });

    await pressAndSpeak(harness, 6);
    harness.helper.emitHotkey('up');
    harness.capture.speak(stampedPcm(6));
    expect(harness.capture.recording).toBe(true);
    harness.helper.emitHotkey('down');

    await expect.poll(() => harness.helper.pasted).toEqual(['6:64000']);
    expect(kinds(harness.states)).toEqual(['recording', 'processing', 'inserted']);
  });

  it('the hotkey 10 minute limit stops the session with the limit notice and transcribes', async () => {
    let now = 1_000_000;
    const harness = await prepared({ clock: () => now });

    await pressAndSpeak(harness, 5);
    now += 600_000;
    harness.helper.emitHotkey('up');

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(5)]);
    expect(harness.states).toContainEqual({ kind: 'processing', notice: 'limit-reached' });
  });

  it('in toggle mode the next press after a readiness error starts a new session', async () => {
    const harness = await prepared({ settings: { mode: 'toggle', localModelId: null } });

    harness.helper.emitHotkey('down');
    await expect.poll(() => lastVisible(harness.states)).toMatchObject({ kind: 'error', message: 'Lokálny model chýba' });
    harness.helper.emitHotkey('up');
    await harness.settings.update({ localModelId: 'tiny' });
    await pressAndSpeak(harness, 4);
    harness.helper.emitHotkey('up');
    harness.helper.emitHotkey('down');

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(4)]);
    expect(harness.capture.starts).toHaveLength(2);
  });

  it('in toggle mode the next press after a microphone failure starts a new session', async () => {
    const harness = await prepared({ settings: { mode: 'toggle' } });
    harness.capture.failNextStart = true;

    harness.helper.emitHotkey('down');
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Mikrofón sa nepodarilo zapnúť' });
    await pressAndSpeak(harness, 2);
    harness.helper.emitHotkey('down');

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(2)]);
  });

  it('disposing during a recording releases the microphone', async () => {
    const harness = await prepared();

    await pressAndSpeak(harness, 3);
    harness.coordinator.dispose();

    await expect.poll(() => harness.capture.recording).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(harness.helper.pasted).toEqual([]);
    await expect(readRecordedCalls(argsFile)).resolves.toEqual([]);
  });

  it('dispose aborts a running transcription and inserts nothing', async () => {
    await setWorkerMode('hang');
    const harness = await prepared();

    await dictate(harness, 3);
    await expect.poll(() => readRecordedCalls(argsFile)).toHaveLength(1);
    harness.coordinator.dispose();

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.lastTranscript.get()).toBeNull();
    expect(lastVisible(harness.states)).toEqual({ kind: 'processing' });
  });
  it('shows the live transcript while recording and processing in Živý text and inserts the joined finals', async () => {
    const samples = timelineSpeech(6);
    await useTimeline(samples);
    let now = 0;
    const harness = await prepared({ binary: FAKE_TIMELINE_CLI, settings: { overlay: 'live' }, engineClock: { now: () => now } });

    await speakTimeline(harness, samples, () => {
      now += 1000;
    });
    await expect.poll(() => harness.states.some((state) => state.kind === 'recording' && (state.live?.tentative ?? '') !== '')).toBe(true);
    harness.helper.emitHotkey('up');

    await expect.poll(() => harness.helper.pasted).toEqual([expectedText(samples)]);
    const recordings = harness.states.filter((state) => state.kind === 'recording');
    expect(recordings.every((state) => state.live !== undefined)).toBe(true);
    const processing = harness.states.filter((state) => state.kind === 'processing');
    expect(processing.length).toBeGreaterThan(0);
    expect(processing.every((state) => state.live !== undefined)).toBe(true);
    expect(processing.at(-1)?.live).toEqual({ confirmed: expectedText(samples), tentative: '' });
  });

  it('keeps restoration failure visible through later live finals and insertion', async () => {
    const samples = timelineSpeech(6);
    await useTimeline(samples);
    vi.stubEnv('CW_WORKER_DELAY_MS', '300');
    let now = 0;
    const harness = await prepared({ binary: FAKE_TIMELINE_CLI, settings: { overlay: 'live', muteWhileRecording: true }, engineClock: { now: () => now } });
    const begin = harness.helper.beginRecordingAudio.bind(harness.helper);
    harness.helper.beginRecordingAudio = async (settings) => {
      await begin(settings);
      return { finish: () => Promise.reject(new Error('restore-failed-live')) };
    };
    await speakTimeline(harness, samples, () => { now += 1000; });
    await expect.poll(() => harness.states.some((state) => state.kind === 'recording' && (state.live?.tentative ?? '') !== '')).toBe(true);
    harness.helper.emitHotkey('up');
    await harness.coordinator.settled();
    expect(harness.coordinator.isBusy()).toBe(true);
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.states.at(-1)).toMatchObject({ kind: 'error', message: 'Zvukový výstup sa nepodarilo nastaviť alebo obnoviť. Skontrolujte zvuk systému.' });
    const warning = harness.states.length - 1;
    await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
    expect(harness.helper.pasted).toEqual([expectedText(samples)]);
    expect(harness.lastTranscript.get()).toBe(expectedText(samples));
    expect(kinds(harness.states.slice(warning))).toEqual(['error']);
    expect(harness.helper.outputMuted).toBe(true);
  });

  it('never shows transcript text in Indikátor mode', async () => {
    const samples = timelineSpeech(6);
    await useTimeline(samples);
    let now = 0;
    const harness = await prepared({ binary: FAKE_TIMELINE_CLI, engineClock: { now: () => now } });

    await speakTimeline(harness, samples, () => {
      now += 1000;
    });
    harness.helper.emitHotkey('up');

    await expect.poll(() => harness.helper.pasted).toEqual([expectedText(samples)]);
    expect(harness.states.some((state) => 'live' in state)).toBe(false);
  });
  describe('failed recording retry', () => {
    const FAILED = { kind: 'error', message: MESSAGES.transcriptionFailed, action: 'retry' } as const;

    async function failOnce(harness: Harness, marker: number): Promise<Uint8Array> {
      await setWorkerMode('fail');
      await dictate(harness, marker);
      await expect.poll(() => lastVisible(harness.states), { timeout: 5000 }).toEqual(FAILED);
      await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
      const held = harness.failedRecording.get();
      expect(held).not.toBeNull();
      return held as Uint8Array;
    }

    it('keeps a failed recording and inserts it on retry like a normal dictation', async () => {
      const harness = await prepared();
      await failOnce(harness, 3);
      expect(harness.helper.pasted).toEqual([]);
      expect(offeredActions(FAILED)).toEqual(['retry']);

      await setWorkerMode('echo-chunk');
      harness.coordinator.act('retry');
      harness.coordinator.act('retry');

      await expect.poll(() => harness.helper.pasted, { timeout: 5000 }).toEqual([ONE_SECOND_TEXT(3)]);
      await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
      expect(harness.helper.pasted).toEqual([ONE_SECOND_TEXT(3)]);
      expect(harness.capture.starts).toHaveLength(1);
      expect(harness.failedRecording.get()).toBeNull();
      expect(harness.lastTranscript.get()).toBe(ONE_SECOND_TEXT(3));
      expect(lastVisible(harness.states)).toMatchObject({ kind: 'inserted' });
      await expect.poll(() => harness.history.view()).toMatchObject({ entries: [{ text: ONE_SECOND_TEXT(3) }] });
      await expect.poll(() => harness.stats.days()).toEqual([{ date: localDate(new Date()), words: 1, dictations: 1, seconds: 1 }]);
    });

    it('keeps the recording after a failed retry and drops it when a new recording starts', async () => {
      const harness = await prepared();
      const held = await failOnce(harness, 3);
      const failures = harness.states.filter((state) => state.kind === 'error').length;

      harness.coordinator.act('retry');

      await expect.poll(() => harness.states.filter((state) => state.kind === 'error').length, { timeout: 5000 }).toBe(failures + 1);
      await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
      expect(lastVisible(harness.states)).toEqual(FAILED);
      expect(harness.failedRecording.get()).toBe(held);

      harness.helper.emitHotkey('down');
      expect(harness.failedRecording.get()).toBeNull();
      harness.coordinator.act('retry');
      await expect.poll(() => harness.capture.recording).toBe(true);
      harness.helper.emitHotkey('up');
      await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
      expect(harness.helper.pasted).toEqual([]);
    });

    it.each(['escape', 'overlay button'] as const)('cancels a retry on %s and keeps the recording', async (via) => {
      const harness = await prepared();
      const held = await failOnce(harness, 3);
      await setWorkerMode('hang');

      harness.coordinator.act('retry');
      await expect.poll(() => harness.states.at(-1)).toEqual({ kind: 'processing' });
      expect(offeredActions({ kind: 'processing' })).toEqual(['cancel']);
      cancelVia(harness, via);

      await expect.poll(() => harness.coordinator.isBusy(), { timeout: 3000 }).toBe(false);
      expect(harness.states.at(-1)).toEqual({ kind: 'hidden' });
      expect(harness.helper.sessionShortcuts).toEqual([]);
      expect(harness.helper.pasted).toEqual([]);
      expect(harness.failedRecording.get()).toBe(held);
    });

    it('shows the not-ready state when no engine is ready at retry and keeps the recording', async () => {
      const harness = await prepared();
      const held = await failOnce(harness, 3);
      await setWorkerMode('echo-chunk');
      await harness.settings.update({ localModelId: null });

      harness.coordinator.act('retry');

      await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Lokálny model chýba', action: 'download-model', alternative: 'pair-server' });
      await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
      expect(harness.helper.pasted).toEqual([]);
      expect(harness.failedRecording.get()).toBe(held);
    });

    it('holds nothing when a retry started before the ten-minute cap fails after it', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const harness = await prepared();
        await failOnce(harness, 3);
        await setWorkerMode('hang');
        harness.coordinator.act('retry');
        await expect.poll(() => harness.states.at(-1)).toEqual({ kind: 'processing' });
        await setWorkerMode('fail');

        vi.advanceTimersByTime(10 * 60_000);
        expect(harness.failedRecording.get()).toBeNull();

        await expect.poll(() => lastVisible(harness.states), { timeout: 5000 }).toEqual({ kind: 'error', message: MESSAGES.transcriptionFailed });
        await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
        expect(harness.failedRecording.get()).toBeNull();
        harness.coordinator.act('retry');
        expect(harness.coordinator.isBusy()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    }, 20_000);

    it('drops the recording when the app shuts down', async () => {
      const harness = await prepared();
      await failOnce(harness, 3);

      await harness.coordinator.shutdown();

      expect(harness.failedRecording.get()).toBeNull();
    });

    it('keeps nothing after a cancelled dictation', async () => {
      const harness = await prepared();
      await pressAndSpeak(harness, 3);

      cancelVia(harness, 'escape');

      await expect.poll(() => harness.coordinator.isBusy()).toBe(false);
      expect(harness.failedRecording.get()).toBeNull();
      harness.coordinator.act('retry');
      expect(harness.coordinator.isBusy()).toBe(false);
    });

    it.each([['darwin', 'metal'], ['linux', 'auto']] as const)('retries a GPU worker crash once on CPU during a dictation on %s', async (platform, backend) => {
      const starts = join(scratch, 'starts.jsonl');
      vi.stubEnv('CW_WORKER_STARTS', starts);
      await setWorkerMode('fail-accelerated');
      const harness = await prepared({ platform });

      await dictate(harness, 5);

      await expect.poll(() => harness.helper.pasted, { timeout: 5000 }).toEqual([expect.stringMatching(/:auto:16000$/)]);
      expect(harness.failedRecording.get()).toBeNull();
      const backends = (await readFile(starts, 'utf8')).trim().split('\n').map((line) => {
        const { args } = JSON.parse(line) as { args: string[] };
        return args[args.indexOf('--backend') + 1];
      });
      expect(backends).toEqual([backend, 'cpu']);
    });
  });
});

async function useTimeline(samples: Int16Array): Promise<void> {
  await writeTimeline(join(scratch, 'source.pcm'), samples);
  vi.stubEnv('FAKE_TIMELINE_SOURCE', join(scratch, 'source.pcm'));
}

async function speakTimeline(harness: Harness, samples: Int16Array, tick: () => void): Promise<void> {
  harness.helper.emitHotkey('down');
  await expect.poll(() => harness.capture.starts.length).toBe(1);
  for (const frame of secondFrames(samples)) {
    tick();
    harness.capture.speak(frame);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
