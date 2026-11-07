import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDiarizer } from '../src/main/models/diarizer';
import { SettingsStore } from '../src/main/settings/settings-store';
import type { DiarizerView } from '../src/shared/models';
import { FakeHuggingFace } from './fake-hugging-face';
import { modelUrlPath, testEntry } from './model-fixtures';
import { RecordingLogger } from './recording-logger';

let scratch: string;
let settings: SettingsStore;
let server: FakeHuggingFace;
const payload = randomBytes(64 * 1024);

function diarizer(sha256?: string) {
  const entry = testEntry('sortformer', payload, { roles: ['diarizer'], roleLabels: ['Rozpoznávanie hovoriacich'], ...(sha256 === undefined ? {} : { sha256 }) });
  return createDiarizer({ dir: join(scratch, 'models'), entry, settings, logger: new RecordingLogger(), fetchImpl: server.fetchImpl });
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-diarizer-'));
  settings = new SettingsStore(join(scratch, 'settings.json'));
  await settings.load();
  server = new FakeHuggingFace();
  await server.start();
  server.serve(modelUrlPath('sortformer'), { body: payload });
});

afterEach(async () => {
  await server.stop();
  await rm(scratch, { recursive: true, force: true });
});

it('offers the model path only after a verified download and never makes it the dictation model', async () => {
  const speakers = diarizer();
  const views: DiarizerView[] = [];
  speakers.onChange((view) => views.push(view));

  expect(speakers.view()).toMatchObject({ model: { id: 'sortformer', roleLabels: ['Rozpoznávanie hovoriacich'] }, state: { status: 'not-downloaded' } });
  await expect(speakers.modelPath()).resolves.toBeNull();

  await speakers.download();

  expect(speakers.view().state).toMatchObject({ status: 'ready', receivedBytes: payload.byteLength });
  expect(views.at(-1)?.state.status).toBe('ready');
  await expect(speakers.modelPath()).resolves.toBe(join(scratch, 'models', 'sortformer.gguf'));
  expect(settings.get().localModelId).toBeNull();
});

it('rejects a download that does not match its SHA-256', async () => {
  const speakers = diarizer('0'.repeat(64));

  await expect(speakers.download()).rejects.toThrow('SHA-256');

  expect(speakers.view().state.status).toBe('broken');
  await expect(speakers.modelPath()).resolves.toBeNull();
});
