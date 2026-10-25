import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { E2eHooks } from '../src/main/app/e2e-hooks';
import { createUserDataDir, FAKE_DEVICE_ARGS, FAKE_MEDIA_ARGS, launchApp, removeUserDataDir } from './launch-app';

type HookGlobal = { codevoE2e: E2eHooks; levelCount: number };

type StreamWindow = Window & { capturedStreams: MediaStream[] };

const RECORD_MS = 1000;
const EXPECTED_BYTES = 32_000;
const SYSTEM_DEFAULT = { deviceId: null, label: null };

let app: ElectronApplication;
let userDataDir: string;

async function openCapturePage(): Promise<Page> {
  await app.evaluate(async () => {
    await (globalThis as unknown as HookGlobal).codevoE2e.capture.listDevices();
  });
  const page = app.windows().find((candidate) => candidate.url().endsWith('/capture/capture.html'));
  expect(page).toBeDefined();
  const capture = page as Page;
  await capture.evaluate(() => {
    const target = window as unknown as StreamWindow;
    target.capturedStreams = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      target.capturedStreams.push(stream);
      return stream;
    };
  });
  return capture;
}

function trackStates(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as StreamWindow).capturedStreams.flatMap((stream) => stream.getTracks().map((track) => `${track.kind}:${track.readyState}`)));
}

function countLevels(): Promise<void> {
  return app.evaluate(() => {
    const hooks = globalThis as unknown as HookGlobal;
    hooks.levelCount = 0;
    hooks.codevoE2e.capture.onLevel(() => {
      hooks.levelCount += 1;
    });
  });
}

function levelCount(): Promise<number> {
  return app.evaluate(() => (globalThis as unknown as HookGlobal).levelCount);
}

function launchWith(chromiumArgs: readonly string[]): void {
  test.beforeEach(async () => {
    userDataDir = await createUserDataDir();
    app = await launchApp(userDataDir, chromiumArgs);
    await app.firstWindow();
  });

  test.afterEach(async () => {
    await app.close();
    await removeUserDataDir(userDataDir);
  });
}

function requestMedia(constraints: MediaStreamConstraints): Promise<string> {
  return navigator.mediaDevices.getUserMedia(constraints).then(
    (stream) => {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      return 'granted';
    },
    (error: unknown) => (error instanceof DOMException ? error.name : String(error)),
  );
}

test.describe('with Chromium fake media', () => {
  launchWith(FAKE_MEDIA_ARGS);

  test('records about one second of 16 kHz PCM16 and releases the microphone', async () => {
    const capture = await openCapturePage();
    await countLevels();

    const started = await app.evaluate((_electron, chosen) => (globalThis as unknown as HookGlobal).codevoE2e.capture.start(chosen), SYSTEM_DEFAULT);
    expect(started.fallback).toBe(false);
    expect(started.deviceLabel).not.toBe('');
    expect(await trackStates(capture)).toEqual(['audio:live']);

    await new Promise((resolve) => setTimeout(resolve, RECORD_MS));
    const bytes = await app.evaluate(async () => (await (globalThis as unknown as HookGlobal).codevoE2e.capture.stop()).byteLength);

    expect(bytes).toBeGreaterThanOrEqual(EXPECTED_BYTES * 0.9);
    expect(bytes).toBeLessThanOrEqual(EXPECTED_BYTES * 1.1);
    expect(bytes % 2).toBe(0);
    expect(await levelCount()).toBeGreaterThanOrEqual(10);
    expect(await trackStates(capture)).toEqual(['audio:ended']);
  });

  test('lists the inputs and falls back to the system default for a missing device', async () => {
    await openCapturePage();

    const devices = await app.evaluate(() => (globalThis as unknown as HookGlobal).codevoE2e.capture.listDevices());
    expect(devices.length).toBeGreaterThan(0);
    expect(devices.every((device) => device.deviceId !== 'default' && device.label !== '')).toBe(true);
    const chosen = devices[0] as (typeof devices)[number];

    const exact = await app.evaluate(async (_electron, microphone) => {
      const { capture } = (globalThis as unknown as HookGlobal).codevoE2e;
      const result = await capture.start(microphone);
      await capture.stop();
      return result;
    }, { deviceId: chosen.deviceId, label: chosen.label });
    expect(exact).toEqual({ fallback: false, deviceLabel: chosen.label });

    const missing = await app.evaluate(async () => {
      const { capture } = (globalThis as unknown as HookGlobal).codevoE2e;
      const result = await capture.start({ deviceId: 'unplugged-airpods', label: 'Matúš AirPods Pro' });
      await capture.stop();
      return result;
    });
    expect(missing.fallback).toBe(true);
    expect(missing.deviceLabel).not.toBe('');
  });

  test('the settings meter reports levels without recording and releases the microphone', async () => {
    const capture = await openCapturePage();
    await countLevels();

    await app.evaluate((_electron, chosen) => (globalThis as unknown as HookGlobal).codevoE2e.capture.startMeter(chosen), SYSTEM_DEFAULT);
    await expect.poll(levelCount).toBeGreaterThan(3);
    expect(await trackStates(capture)).toEqual(['audio:live']);

    await app.evaluate(() => (globalThis as unknown as HookGlobal).codevoE2e.capture.stopMeter());

    expect(await trackStates(capture)).toEqual(['audio:ended']);
    expect(await app.evaluate(async () => (await (globalThis as unknown as HookGlobal).codevoE2e.capture.stop()).byteLength)).toBe(0);
  });


  test('switching from the settings meter to a recording records audio and releases every track', async () => {
    const capture = await openCapturePage();

    const bytes = await app.evaluate(async (_electron, chosen) => {
      const { capture: audio } = (globalThis as unknown as HookGlobal).codevoE2e;
      await audio.startMeter(chosen);
      await audio.start(chosen);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return (await audio.stop()).byteLength;
    }, SYSTEM_DEFAULT);

    expect(bytes).toBeGreaterThan(0);
    expect(await trackStates(capture)).toEqual(['audio:ended', 'audio:ended']);
  });

  test('records with the system default when the chosen device vanishes before it opens', async () => {
    const capture = await openCapturePage();
    const devices = await app.evaluate(() => (globalThis as unknown as HookGlobal).codevoE2e.capture.listDevices());
    const chosen = devices[0] as (typeof devices)[number];
    await capture.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (constraints) => {
        const audio = constraints?.audio;
        if (typeof audio === 'object' && audio.deviceId !== undefined) {
          return Promise.reject(new DOMException('Requested device not found', 'NotFoundError'));
        }
        return original(constraints);
      };
    });

    const result = await app.evaluate(async (_electron, microphone) => {
      const { capture: audio } = (globalThis as unknown as HookGlobal).codevoE2e;
      const started = await audio.start(microphone);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { started, bytes: (await audio.stop()).byteLength };
    }, { deviceId: chosen.deviceId, label: chosen.label });

    expect(result.started.fallback).toBe(true);
    expect(result.started.deviceLabel).not.toBe('');
    expect(result.bytes).toBeGreaterThan(0);
    expect(await trackStates(capture)).toEqual(['audio:ended']);
  });
});

test.describe('with the app permission handler', () => {
  launchWith(FAKE_DEVICE_ARGS);

  test('grants the microphone to the capture window only and never the camera', async () => {
    const capture = await openCapturePage();
    const main = await app.firstWindow();

    expect(await capture.evaluate(requestMedia, { audio: true })).toBe('granted');
    expect(await main.evaluate(requestMedia, { audio: true })).toBe('NotAllowedError');
    expect(await capture.evaluate(requestMedia, { video: true })).toBe('NotAllowedError');
    expect(await capture.evaluate(requestMedia, { audio: true, video: true })).toBe('NotAllowedError');
  });

  test('records through the real permission handler and sees device labels', async () => {
    await openCapturePage();

    const devices = await app.evaluate(() => (globalThis as unknown as HookGlobal).codevoE2e.capture.listDevices());
    expect(devices.length).toBeGreaterThan(0);
    expect(devices.every((device) => device.label !== '')).toBe(true);

    const bytes = await app.evaluate(async () => {
      const { capture } = (globalThis as unknown as HookGlobal).codevoE2e;
      await capture.start({ deviceId: null, label: null });
      await new Promise((resolve) => setTimeout(resolve, 300));
      return (await capture.stop()).byteLength;
    });
    expect(bytes).toBeGreaterThan(0);
  });
});
