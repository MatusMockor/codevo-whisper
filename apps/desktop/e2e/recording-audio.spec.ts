import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { E2eHooks } from '../src/main/app/e2e-hooks';
import type { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import { createUserDataDir, FAKE_MEDIA_ARGS, launchApp, ONBOARDED, removeUserDataDir } from './launch-app';
import { startLocalGateway, type LocalGateway } from './local-gateway';

type Hooks = { codevoE2e: E2eHooks & { helper: FakeInputHelper }; recordingFrames: number; recordingBytes: number; unmutedFrames: number; audioEvents: string[] };

let app: ElectronApplication;
let page: Page;
let dir: string;
let gateway: LocalGateway;

test.beforeEach(async () => {
  gateway = await startLocalGateway();
  dir = await createUserDataDir({ ...ONBOARDED, hotkey: { kind: 'modifiers', keycodes: [63], label: 'Fn' }, mode: 'hold', muteWhileRecording: true, audioFeedback: true, feedbackOutputId: 'headphones', feedbackVolume: 73 });
  app = await launchApp(dir, FAKE_MEDIA_ARGS, { fakeHelper: true });
  page = await app.firstWindow();
  const pairing = await gateway.openPairingWindow();
  await page.evaluate((token) => window.codevo.pairServer(token), pairing.token);
  await pairing.admin.next();
  pairing.admin.send({ decision: 'approve' });
  await pairing.admin.next();
  pairing.admin.close();
  await expect.poll(() => page.evaluate(() => window.codevo.getServer().then((view) => view.server?.status.kind))).toBe('online');
  await page.evaluate(() => window.codevo.updateSettings({ engineOrder: ['server'] }));
  await expect.poll(() => page.evaluate(() => window.codevo.isHotkeyArmed())).toBe(true);
  await app.evaluate(() => {
    const hooks = globalThis as unknown as Hooks;
    hooks.recordingFrames = 0;
    hooks.recordingBytes = 0;
    hooks.unmutedFrames = 0;
    hooks.audioEvents = [];
    hooks.codevoE2e.capture.onFrame((pcm) => {
      hooks.recordingFrames++;
      hooks.recordingBytes += pcm.byteLength;
      if (!hooks.codevoE2e.helper.outputMuted) hooks.unmutedFrames++;
    });
  });
});

test.afterEach(async () => {
  await app.close();
  await gateway.close();
  await removeUserDataDir(dir);
});

function edge(phase: 'down' | 'up'): Promise<void> {
  return app.evaluate((_electron, value) => (globalThis as unknown as Hooks).codevoE2e.helper.emitHotkey(value), phase);
}

function audioState() {
  return app.evaluate(() => {
    const hooks = globalThis as unknown as Hooks;
    return { muted: hooks.codevoE2e.helper.outputMuted, trace: hooks.codevoE2e.helper.audioTrace, frames: hooks.recordingFrames, bytes: hooks.recordingBytes, unmutedFrames: hooks.unmutedFrames, text: hooks.codevoE2e.helper.pasted };
  });
}

test('real microphone capture restores fixture output before insertion and leaves the meter untouched', async () => {
  await page.getByRole('tab', { name: 'Nastavenia' }).click();
  await expect(page.getByRole('meter', { name: 'Úroveň mikrofónu' })).toBeVisible();
  expect((await audioState()).trace).toEqual([]);
  await edge('down');
  await expect.poll(() => audioState().then((state) => state.frames)).toBeGreaterThan(2);
  expect(await audioState()).toMatchObject({ muted: true, trace: ['start:headphones:73', 'mute'] });
  await edge('up');
  await expect.poll(() => audioState().then((state) => state.muted)).toBe(false);
  await expect.poll(() => audioState().then((state) => state.text)).toEqual(['prepis zo servera']);
  const state = await audioState();
  expect(state.bytes).toBeGreaterThan(0);
  expect(state.unmutedFrames).toBe(0);
  expect(state.trace).toEqual(['start:headphones:73', 'mute', 'restore:false', 'stop:headphones:73']);
});

test('ordinary Electron quit waits for held fixture restoration before exit', async () => {
  await app.evaluate(({ app: electronApp }) => {
    const hooks = globalThis as unknown as Hooks;
    const helper = hooks.codevoE2e.helper;
    const begin = helper.beginRecordingAudio.bind(helper);
    helper.beginRecordingAudio = async (settings) => {
      const lease = await begin(settings);
      return { finish: async (options) => {
        hooks.audioEvents.push('restore-start');
        await new Promise((resolve) => setTimeout(resolve, 200));
        await lease.finish(options);
        hooks.audioEvents.push(`restore-end:${helper.outputMuted}`);
      } };
    };
    const events = hooks.audioEvents;
    electronApp.on('will-quit', () => { process.stdout.write(`CW_AUDIO_QUIT ${JSON.stringify(events)}\n`); });
  });
  await edge('down');
  await expect.poll(() => audioState().then((state) => state.frames)).toBeGreaterThan(1);
  const chunks: string[] = [];
  app.process().stdout?.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
  await app.close();
  expect(chunks.join('')).toContain('CW_AUDIO_QUIT ["restore-start","restore-end:false"]');
});

test('relaunch IPC drains fixture restoration before helper stop and process actions', async () => {
  await app.evaluate(({ app: electronApp }) => {
    const hooks = globalThis as unknown as Hooks;
    const helper = hooks.codevoE2e.helper;
    const begin = helper.beginRecordingAudio.bind(helper);
    helper.beginRecordingAudio = async (settings) => {
      const lease = await begin(settings);
      return { finish: async (options) => {
        hooks.audioEvents.push('restore-start');
        await new Promise((resolve) => setTimeout(resolve, 100));
        await lease.finish(options);
        hooks.audioEvents.push(`restore-end:${helper.outputMuted}`);
      } };
    };
    const stop = helper.stop.bind(helper);
    helper.stop = () => { hooks.audioEvents.push(`helper-stop:${helper.outputMuted}`); return stop(); };
    electronApp.relaunch = () => { hooks.audioEvents.push(`relaunch:${helper.outputMuted}`); };
    electronApp.exit = () => { hooks.audioEvents.push('exit'); };
  });
  await edge('down');
  await expect.poll(() => audioState().then((state) => state.frames)).toBeGreaterThan(1);
  await page.evaluate(() => window.codevo.relaunch());
  expect(await app.evaluate(() => (globalThis as unknown as Hooks).audioEvents)).toEqual(['restore-start', 'restore-end:false', 'helper-stop:false', 'relaunch:false', 'exit']);
  expect((await audioState()).trace).toEqual(['start:headphones:73', 'mute', 'restore:false']);
});
