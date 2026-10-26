import type { Clock } from '@codevo-whisper/audio';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowAudioCapture } from '../src/main/audio/window-audio-capture';
import { EngineSelector } from '../src/main/engines/engine-selector';
import { LocalEngine } from '../src/main/engines/local-engine';
import { FakeInputHelper, type FakeInputHelperState } from '../src/main/helper/fake-input-helper';
import type { AppTarget } from '../src/main/helper/input-helper';
import { HotkeyService } from '../src/main/hotkey/hotkey-service';
import { InsertionService } from '../src/main/insertion/insertion-service';
import { LastTranscript } from '../src/main/insertion/last-transcript';
import { ModelManager } from '../src/main/models/model-manager';
import { PauseState } from '../src/main/session/pause-state';
import { SessionCoordinator } from '../src/main/session/session-coordinator';
import { SettingsStore } from '../src/main/settings/settings-store';
import { coordinatorDictationGuard } from '../src/main/updates/coordinator-dictation-guard';
import { StatsStore } from '../src/main/stats/stats-store';
import { localDate } from '../src/shared/calendar-date';
import type { OverlayState } from '../src/shared/overlay-contract';
import type { Settings } from '../src/shared/settings';
import { FAKE_CLI, readRecordedCalls } from '../../../packages/stt-runner/test/support/fake-cli';
import { FakeCaptureHost } from './fake-capture-host';
import { FakePowerEvents } from './fake-power-events';
import { InProcessCapture, stampedPcm } from './in-process-capture';
import { testEntry } from './model-fixtures';
import { RecordingLogger } from './recording-logger';
import { expectedText, secondFrames, timelineSpeech, writeTimeline } from './support/timeline-audio';

const FN = { keycode: 63, label: 'Fn / 🌐' } as const;
const MODEL_BODY = 'GGUF';
const NOTES: AppTarget = { bundleId: 'com.apple.Notes', pid: 200, name: 'Notes', windowId: 4 };
const ONE_SECOND_TEXT = (marker: number): string => `${marker}:32000`;
const FAKE_TIMELINE_CLI = fileURLToPath(new URL('./support/fake-timeline-cli.js', import.meta.url));

type Setup = { settings?: Partial<Settings>; helper?: Partial<FakeInputHelperState>; binary?: string; clock?: () => number; engineClock?: Clock };

type Harness = Awaited<ReturnType<typeof prepared>>;

let scratch: string;
let argsFile: string;
let coordinator: SessionCoordinator | null = null;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-session-'));
  argsFile = join(scratch, 'args.txt');
  vi.stubEnv('FAKE_CLI_ARGS_FILE', argsFile);
  vi.stubEnv('FAKE_CLI_MODE', 'echo-chunk');
});

afterEach(async () => {
  coordinator?.dispose();
  coordinator = null;
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

async function prepared(setup: Setup = {}) {
  const logger = new RecordingLogger();
  const settings = new SettingsStore(join(scratch, 'settings.json'), logger);
  await settings.load();
  await settings.update({ hotkey: FN, localModelId: 'tiny', ...setup.settings });
  const modelsDir = join(scratch, 'models');
  await mkdir(modelsDir, { recursive: true });
  await writeFile(join(modelsDir, 'tiny.gguf'), MODEL_BODY);
  const models = new ModelManager({ dir: modelsDir, catalog: [testEntry('tiny', MODEL_BODY)], settings, warmUp: () => Promise.resolve(), logger });
  const engineClock = setup.engineClock === undefined ? {} : { clock: setup.engineClock };
  const engine = new LocalEngine({ binary: setup.binary ?? FAKE_CLI, models, settings, arch: 'arm64', ...engineClock });
  const helper = new FakeInputHelper({ clipboard: 'original', ...setup.helper });
  const power = new FakePowerEvents();
  const hotkey = new HotkeyService(helper, settings, power, setup.clock ?? (() => Date.now()), logger);
  await hotkey.start();
  const capture = new InProcessCapture();
  const lastTranscript = new LastTranscript();
  const insertion = new InsertionService(helper, settings, lastTranscript, () => Promise.resolve(), logger);
  const states: OverlayState[] = [];
  const settingsOpened: string[] = [];
  const stats = new StatsStore(join(scratch, 'stats.json'), undefined, logger);
  const pause = new PauseState(logger);
  coordinator = new SessionCoordinator({
    hotkey,
    capture,
    engines: new EngineSelector([engine]),
    insertion,
    lastTranscript,
    helper,
    settings,
    stats,
    pause,
    overlay: (state) => states.push(state),
    openSettings: () => settingsOpened.push('settings'),
    logger,
  });
  coordinator.start();
  return { settings, helper, power, hotkey, capture, lastTranscript, states, settingsOpened, logger, coordinator, modelsDir, stats, pause };
}

async function pressAndSpeak(harness: Harness, marker: number): Promise<void> {
  const starts = harness.capture.starts.length;
  harness.helper.pressKey('down', FN.keycode);
  await expect.poll(() => harness.capture.starts.length).toBe(starts + 1);
  harness.capture.speak(stampedPcm(marker));
}

async function dictate(harness: Harness, marker: number): Promise<void> {
  await pressAndSpeak(harness, marker);
  harness.helper.pressKey('up', FN.keycode);
}

function kinds(states: OverlayState[]): string[] {
  return states.map((state) => state.kind).filter((kind, index, all) => kind !== all[index - 1]);
}

function lastVisible(states: OverlayState[]): OverlayState | undefined {
  return states.filter((state) => state.kind !== 'hidden').at(-1);
}

describe('SessionCoordinator', () => {
  it('records, transcribes and inserts', async () => {
    const harness = await prepared();

    await dictate(harness, 7);

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'inserted', appName: 'TextEdit' });
    const [first] = harness.states;
    expect(first).toEqual({ kind: 'recording', elapsedMs: expect.any(Number) as number, level: 0, language: 'SK' });
    expect(first?.kind === 'recording' && first.elapsedMs < 100).toBe(true);
    expect(harness.states.some((state) => state.kind === 'recording' && state.level === 0.2)).toBe(true);
    expect(kinds(harness.states)).toEqual(['recording', 'processing', 'inserted']);
    expect(harness.lastTranscript.get()).toBe(ONE_SECOND_TEXT(7));
    expect(harness.helper.clipboard).toBe('original');
    expect(harness.capture.recording).toBe(false);
    expect(harness.capture.starts).toEqual([{ deviceId: null, label: null }]);
    const [call] = await readRecordedCalls(argsFile);
    expect(call?.[call.indexOf('--language') + 1]).toBe('sk');
    await expect.poll(() => harness.states.at(-1), { timeout: 3000 }).toEqual({ kind: 'hidden' });
  });

  it('shows the fallback microphone notice', async () => {
    const harness = await prepared({ settings: { microphone: { deviceId: 'airpods-id', label: 'AirPods Pro' } } });

    await dictate(harness, 3);

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(3)]);
    const recordings = harness.states.filter((state) => state.kind === 'recording');
    expect(recordings.at(-1)).toMatchObject({ fallbackDevice: 'AirPods Pro', level: 0.2 });
    expect(harness.capture.starts).toEqual([{ deviceId: 'airpods-id', label: 'AirPods Pro' }]);
  });

  it('shows no-model error and opens settings action', async () => {
    const harness = await prepared({ settings: { localModelId: null } });

    await dictate(harness, 5);

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Nemáte stiahnutý model', action: 'open-settings' });
    expect(harness.capture.recording).toBe(false);
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.lastTranscript.get()).toBeNull();
    await expect(readRecordedCalls(argsFile)).resolves.toEqual([]);

    harness.coordinator.act('open-settings');

    expect(harness.settingsOpened).toEqual(['settings']);
  });

  it('stops the microphone as soon as the model turns out to be broken', async () => {
    const harness = await prepared();
    await writeFile(join(harness.modelsDir, 'tiny.gguf'), 'XXXX');

    await pressAndSpeak(harness, 5);

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Model chýba alebo je poškodený', action: 'open-settings' });
    expect(harness.capture.recording).toBe(false);
    harness.helper.pressKey('up', FN.keycode);
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
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'inserted', appName: 'TextEdit' });
    const firstProcessing = harness.states.findIndex((state) => state.kind === 'processing');
    const secondStart = harness.states.findIndex((state, index) => index > firstProcessing && state.kind === 'recording');
    const secondProcessing = harness.states.findIndex((state, index) => index > secondStart && state.kind === 'processing');
    expect(harness.states.slice(secondStart, secondProcessing).every((state) => state.kind === 'recording')).toBe(true);
    expect(kinds(harness.states.slice(secondProcessing))).toEqual(['processing', 'inserted']);
  });

  it('blocked insertion keeps the text as last transcript', async () => {
    const harness = await prepared();

    await pressAndSpeak(harness, 4);
    harness.helper.frontmostApp = NOTES;
    harness.helper.pressKey('up', FN.keycode);

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'blocked', reason: 'focus' });
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.helper.clipboard).toBe('original');
    expect(harness.lastTranscript.get()).toBe(ONE_SECOND_TEXT(4));

    harness.coordinator.act('copy-last');

    await expect.poll(() => harness.helper.clipboard).toBe(ONE_SECOND_TEXT(4));
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'copied' });
  });

  it('secure input blocks the paste and keeps the text', async () => {
    const harness = await prepared();

    await pressAndSpeak(harness, 4);
    harness.helper.secureInputEnabled = true;
    harness.helper.pressKey('up', FN.keycode);

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
    const harness = await prepared();
    const interruptions: Array<() => void> = [
      () => harness.power.emit('lock-screen'),
      () => harness.power.emit('suspend'),
      () => harness.helper.loseInput('helper-died'),
      () => harness.coordinator.pause(),
    ];

    for (const interrupt of interruptions) {
      harness.coordinator.resume();
      await pressAndSpeak(harness, 2);
      interrupt();
      await expect.poll(() => harness.capture.recording).toBe(false);
      await expect.poll(() => harness.states.at(-1)).toEqual({ kind: 'hidden' });
      harness.helper.pressKey('up', FN.keycode);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.lastTranscript.get()).toBeNull();
    await expect(readRecordedCalls(argsFile)).resolves.toEqual([]);
    expect(harness.coordinator.isPaused()).toBe(true);
    harness.helper.pressKey('down', FN.keycode);
    expect(harness.capture.starts).toHaveLength(4);
  });

  it('the 10 minute limit stops the session and transcribes what was recorded', async () => {
    const harness = await prepared();

    await pressAndSpeak(harness, 5);
    harness.capture.reachLimit();

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(5)]);
    expect(harness.states).toContainEqual({ kind: 'processing', notice: 'limit-reached' });
    harness.helper.pressKey('up', FN.keycode);
    harness.helper.pressKey('down', FN.keycode);
    await expect.poll(() => harness.capture.starts).toHaveLength(2);
  });

  it('reports a microphone that cannot start and inserts nothing', async () => {
    const harness = await prepared();
    harness.capture.failNextStart = true;

    harness.helper.pressKey('down', FN.keycode);
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Mikrofón sa nepodarilo zapnúť' });
    harness.helper.pressKey('up', FN.keycode);

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

    harness.helper.pressKey('down', FN.keycode);
    harness.helper.pressKey('up', FN.keycode);

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Mikrofón sa nepodarilo zapnúť' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Mikrofón sa nepodarilo zapnúť' });
    await expect(readRecordedCalls(argsFile)).resolves.toEqual([]);
  });

  it('reports a failed transcription and silence without inserting', async () => {
    const harness = await prepared();

    harness.helper.pressKey('down', FN.keycode);
    await expect.poll(() => harness.capture.recording).toBe(true);
    harness.helper.pressKey('up', FN.keycode);
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Nezachytila sa žiadna reč' });

    vi.stubEnv('FAKE_CLI_MODE', 'fail');
    await dictate(harness, 3);

    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Prepis sa nepodaril' });
    expect(harness.helper.pasted).toEqual([]);
    expect(harness.lastTranscript.get()).toBeNull();
  });

  it('records stats after a successful dictation and not after an empty or failed one', async () => {
    const harness = await prepared();

    harness.helper.pressKey('down', FN.keycode);
    await expect.poll(() => harness.capture.recording).toBe(true);
    harness.helper.pressKey('up', FN.keycode);
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Nezachytila sa žiadna reč' });
    vi.stubEnv('FAKE_CLI_MODE', 'fail');
    await dictate(harness, 3);
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Prepis sa nepodaril' });
    expect(await harness.stats.days()).toEqual([]);

    vi.stubEnv('FAKE_CLI_MODE', 'echo-chunk');
    await dictate(harness, 7);
    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(7)]);
    const today = localDate(new Date());
    await expect.poll(() => harness.stats.days()).toEqual([{ date: today, words: 1, dictations: 1, seconds: 1 }]);

    await pressAndSpeak(harness, 4);
    harness.helper.frontmostApp = NOTES;
    harness.helper.pressKey('up', FN.keycode);
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'blocked', reason: 'focus' });
    await expect.poll(() => harness.stats.days()).toEqual([{ date: today, words: 2, dictations: 2, seconds: 2 }]);
  });

  it('does not record punctuation-only text as a dictation', async () => {
    vi.stubEnv('FAKE_CLI_MODE', 'text');
    vi.stubEnv('FAKE_CLI_TEXT', '- …');
    const harness = await prepared();

    await dictate(harness, 2);

    await expect.poll(() => harness.helper.pasted).toEqual(['- …']);
    expect(harness.lastTranscript.get()).toBe('- …');
    await new Promise((resolve) => setTimeout(resolve, 50));
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
    harness.helper.pressKey('up', FN.keycode);
    await expect.poll(() => readRecordedCalls(argsFile)).toHaveLength(1);
    expect(harness.coordinator.isDictating()).toBe(true);

    await expect.poll(() => harness.helper.pasted, { timeout: 3000 }).toEqual([ONE_SECOND_TEXT(7)]);
    await expect.poll(() => harness.coordinator.isDictating()).toBe(false);
  });

  it('the update guard pauses dictation, stops the meter and lets the microphone settle before the install', async () => {
    const harness = await prepared();
    const host = new FakeCaptureHost();
    const microphone = new WindowAudioCapture(host, harness.logger);
    await microphone.startMeter({ deviceId: null, label: null });
    const guard = coordinatorDictationGuard({ coordinator: () => harness.coordinator, microphone, meter: microphone, logger: harness.logger });

    const release = await guard.suspend();

    expect(harness.coordinator.isPaused()).toBe(true);
    expect(host.requests.at(-1)).toEqual({ type: 'stop' });
    expect(microphone.isBusy()).toBe(false);
    await expect(microphone.startMeter({ deviceId: null, label: null })).rejects.toThrow('The microphone is closed for an app update');
    harness.helper.pressKey('down', FN.keycode);
    expect(guard.isDictating()).toBe(false);
    release();

    expect(harness.coordinator.isPaused()).toBe(false);
    await expect(microphone.startMeter({ deviceId: null, label: null })).resolves.toBeUndefined();
  });

  it('the update guard keeps a pause the user chose', async () => {
    const harness = await prepared();
    const microphone = new WindowAudioCapture(new FakeCaptureHost(), harness.logger);
    const guard = coordinatorDictationGuard({ coordinator: () => harness.coordinator, microphone, meter: microphone, logger: harness.logger });
    harness.coordinator.pause();

    (await guard.suspend())();

    expect(harness.coordinator.isPaused()).toBe(true);
  });

  it('toggle mode records until the second press and then inserts', async () => {
    const harness = await prepared({ settings: { mode: 'toggle' } });

    await pressAndSpeak(harness, 6);
    harness.helper.pressKey('up', FN.keycode);
    harness.capture.speak(stampedPcm(6));
    expect(harness.capture.recording).toBe(true);
    harness.helper.pressKey('down', FN.keycode);

    await expect.poll(() => harness.helper.pasted).toEqual(['6:64000']);
    expect(kinds(harness.states)).toEqual(['recording', 'processing', 'inserted']);
  });

  it('the hotkey 10 minute limit stops the session with the limit notice and transcribes', async () => {
    let now = 1_000_000;
    const harness = await prepared({ clock: () => now });

    await pressAndSpeak(harness, 5);
    now += 600_000;
    harness.helper.pressKey('up', FN.keycode);

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(5)]);
    expect(harness.states).toContainEqual({ kind: 'processing', notice: 'limit-reached' });
  });

  it('in toggle mode the next press after a readiness error starts a new session', async () => {
    const harness = await prepared({ settings: { mode: 'toggle', localModelId: null } });

    harness.helper.pressKey('down', FN.keycode);
    await expect.poll(() => lastVisible(harness.states)).toMatchObject({ kind: 'error', message: 'Nemáte stiahnutý model' });
    harness.helper.pressKey('up', FN.keycode);
    await harness.settings.update({ localModelId: 'tiny' });
    await pressAndSpeak(harness, 4);
    harness.helper.pressKey('up', FN.keycode);
    harness.helper.pressKey('down', FN.keycode);

    await expect.poll(() => harness.helper.pasted).toEqual([ONE_SECOND_TEXT(4)]);
    expect(harness.capture.starts).toHaveLength(2);
  });

  it('in toggle mode the next press after a microphone failure starts a new session', async () => {
    const harness = await prepared({ settings: { mode: 'toggle' } });
    harness.capture.failNextStart = true;

    harness.helper.pressKey('down', FN.keycode);
    await expect.poll(() => lastVisible(harness.states)).toEqual({ kind: 'error', message: 'Mikrofón sa nepodarilo zapnúť' });
    await pressAndSpeak(harness, 2);
    harness.helper.pressKey('down', FN.keycode);

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
    vi.stubEnv('FAKE_CLI_MODE', 'hang');
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
    harness.helper.pressKey('up', FN.keycode);

    await expect.poll(() => harness.helper.pasted).toEqual([expectedText(samples)]);
    const recordings = harness.states.filter((state) => state.kind === 'recording');
    expect(recordings.every((state) => state.live !== undefined)).toBe(true);
    const processing = harness.states.filter((state) => state.kind === 'processing');
    expect(processing.length).toBeGreaterThan(0);
    expect(processing.every((state) => state.live !== undefined)).toBe(true);
    expect(processing.at(-1)?.live).toEqual({ confirmed: expectedText(samples), tentative: '' });
  });

  it('never shows transcript text in Indikátor mode', async () => {
    const samples = timelineSpeech(6);
    await useTimeline(samples);
    let now = 0;
    const harness = await prepared({ binary: FAKE_TIMELINE_CLI, engineClock: { now: () => now } });

    await speakTimeline(harness, samples, () => {
      now += 1000;
    });
    harness.helper.pressKey('up', FN.keycode);

    await expect.poll(() => harness.helper.pasted).toEqual([expectedText(samples)]);
    expect(harness.states.some((state) => 'live' in state)).toBe(false);
  });
});

async function useTimeline(samples: Int16Array): Promise<void> {
  await writeTimeline(join(scratch, 'source.pcm'), samples);
  vi.stubEnv('FAKE_TIMELINE_SOURCE', join(scratch, 'source.pcm'));
}

async function speakTimeline(harness: Harness, samples: Int16Array, tick: () => void): Promise<void> {
  harness.helper.pressKey('down', FN.keycode);
  await expect.poll(() => harness.capture.starts.length).toBe(1);
  for (const frame of secondFrames(samples)) {
    tick();
    harness.capture.speak(frame);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
