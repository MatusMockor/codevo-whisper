import { expect, test, type ElectronApplication } from '@playwright/test';
import type { E2eHooks } from '../src/main/app/e2e-hooks';
import { createUserDataDir, FAKE_MEDIA_ARGS, launchApp, removeUserDataDir } from './launch-app';

type HookGlobal = { codevoE2e: E2eHooks };

type FrameArrival = { at: number; bytes: number };

type LongRecording = { calledAt: number; startedAt: number; stoppedAt: number; settledAt: number; bytes: number; arrivals: FrameArrival[] };

const LONG_RECORD_MS = 60_000;
const BYTES_PER_MS = 32;
const START_SLACK_MS = 100;
const END_SLACK_MS = 100;
const DELIVERY_SLACK_MS = 300;
const SYSTEM_DEFAULT = { deviceId: null, label: null };

let app: ElectronApplication;
let userDataDir: string;

function recordLong(): Promise<LongRecording> {
  return app.evaluate(
    async (_electron, { chosen, duration }) => {
      const audio = (globalThis as unknown as HookGlobal).codevoE2e.capture;
      const arrivals: FrameArrival[] = [];
      let total = 0;
      const unsubscribe = audio.onFrame((pcm) => {
        total += pcm.byteLength;
        arrivals.push({ at: performance.now(), bytes: total });
      });
      const calledAt = performance.now();
      await audio.start(chosen);
      const startedAt = performance.now();
      await new Promise((resolve) => setTimeout(resolve, duration));
      const stoppedAt = performance.now();
      const bytes = (await audio.stop()).byteLength;
      const settledAt = performance.now();
      unsubscribe();
      return { calledAt, startedAt, stoppedAt, settledAt, bytes, arrivals };
    },
    { chosen: SYSTEM_DEFAULT, duration: LONG_RECORD_MS },
  );
}

function maxLagMs(recording: LongRecording): number {
  return Math.max(...recording.arrivals.map((arrival) => arrival.at - recording.startedAt - arrival.bytes / BYTES_PER_MS));
}

function maxLeadMs(recording: LongRecording): number {
  return Math.max(...recording.arrivals.map((arrival) => arrival.bytes / BYTES_PER_MS - (arrival.at - recording.calledAt)));
}

test.skip(process.env['CW_E2E_LONG'] !== '1', 'Set CW_E2E_LONG=1 to run the 60 s capture check');

test.beforeEach(async () => {
  userDataDir = await createUserDataDir();
  app = await launchApp(userDataDir, FAKE_MEDIA_ARGS);
  await app.firstWindow();
});

test.afterEach(async () => {
  await app.close();
  await removeUserDataDir(userDataDir);
});

test('a 60 s recording holds audio for its whole wall-clock time without gaps', async () => {
  test.setTimeout(LONG_RECORD_MS * 2);

  const recording = await recordLong();
  const missingMs = recording.stoppedAt - recording.startedAt - recording.bytes / BYTES_PER_MS;
  test.info().annotations.push(
    { type: 'missing-ms', description: missingMs.toFixed(1) },
    { type: 'max-lag-ms', description: maxLagMs(recording).toFixed(1) },
    { type: 'max-lead-ms', description: maxLeadMs(recording).toFixed(1) },
  );

  expect(recording.bytes).toBeGreaterThanOrEqual((recording.stoppedAt - recording.startedAt - START_SLACK_MS) * BYTES_PER_MS);
  expect(recording.bytes).toBeLessThanOrEqual((recording.settledAt - recording.calledAt + END_SLACK_MS) * BYTES_PER_MS);
  expect(maxLagMs(recording)).toBeLessThanOrEqual(START_SLACK_MS + DELIVERY_SLACK_MS);
  expect(maxLeadMs(recording)).toBeLessThanOrEqual(END_SLACK_MS);
});
