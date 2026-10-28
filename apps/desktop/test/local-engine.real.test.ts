import { runTranscribeCli } from '@codevo-whisper/stt-runner';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localBackend, localThreads } from '../src/main/engines/local-backend';
import { LocalEngine } from '../src/main/engines/local-engine';
import type { EngineDictation, Preparation, TranscriptUpdate } from '../src/main/engines/transcription-engine';
import { ModelManager } from '../src/main/models/model-manager';
import { SettingsStore } from '../src/main/settings/settings-store';
import { PCM_BYTES_PER_SECOND } from '../src/shared/pcm';
import { sha256OfFile, testEntry } from './model-fixtures';
import { readWavPcm } from './wav-fixture';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ARCH = process.arch === 'x64' ? 'x64' : 'arm64';
const BINARY = join(REPO_ROOT, 'apps', 'desktop', 'resources', 'bin', ARCH, 'cw-stt-worker');
const CLI_BINARY = join(REPO_ROOT, 'apps', 'desktop', 'resources', 'bin', ARCH, 'transcribe-cli');
const SAMPLE = join(REPO_ROOT, 'spikes', 'transcribe-macos', 'sample.wav');
const LONG_SPEECH = join(REPO_ROOT, 'spikes', 'rolling-latency', '.data', 'speech16k.pcm');
const MODEL = process.env['CW_REAL_MODEL'] === undefined ? null : resolve(REPO_ROOT, process.env['CW_REAL_MODEL']);
const AVAILABLE = MODEL !== null && existsSync(MODEL) && existsSync(BINARY) && existsSync(SAMPLE);
const LONG_AVAILABLE = AVAILABLE && existsSync(CLI_BINARY) && existsSync(LONG_SPEECH);

const EXPECTED =
  'Ahoj, toto je skúška prepisu slovenskej reči na grafickej karte. Potrebujem skontrolovať náš editor a potom odoslať zmenu.';

const FRAME_BYTES = PCM_BYTES_PER_SECOND / 10;
const FRAME_MS = 100;
const LONG_SECONDS = 40;

type Measured = { text: string; finishMs: number; partials: number; finalsBeforeFinish: number };

let scratch: string;
let engine: LocalEngine;

async function realEngine(model: string): Promise<LocalEngine> {
  const dir = join(scratch, 'models');
  await mkdir(dir);
  await symlink(model, join(dir, 'real.gguf'));
  const settings = new SettingsStore(join(scratch, 'settings.json'));
  await settings.load();
  await settings.update({ localModelId: 'real' });
  const entry = { ...testEntry('real', ''), sizeBytes: (await stat(model)).size, sha256: await sha256OfFile(model) };
  const models = new ModelManager({ dir, catalog: [entry], settings, warmUp: () => Promise.resolve() });
  return new LocalEngine({ binary: BINARY, models, settings, arch: ARCH });
}

async function start(partials: boolean, updates: TranscriptUpdate[]): Promise<EngineDictation> {
  const preparation = await engine.prepare();
  expect(preparation.ready).toBe(true);
  const options = { language: 'sk' as const, signal: new AbortController().signal, partials, onTranscript: (update: TranscriptUpdate) => updates.push(update) };
  return (preparation as Extract<Preparation, { ready: true }>).engine.start(options);
}

async function streamInRealTime(dictation: EngineDictation, pcm: Uint8Array): Promise<void> {
  const startedAt = performance.now();
  for (let offset = 0, frame = 0; offset < pcm.byteLength; offset += FRAME_BYTES, frame += 1) {
    dictation.push(pcm.subarray(offset, offset + FRAME_BYTES));
    await sleep(Math.max(0, startedAt + (frame + 1) * FRAME_MS - performance.now()));
  }
}

async function measure(partials: boolean, pcm: Uint8Array): Promise<Measured> {
  const updates: TranscriptUpdate[] = [];
  const dictation = await start(partials, updates);
  await streamInRealTime(dictation, pcm);
  const finalsBeforeFinish = updates.filter((update) => update.type === 'final').length;
  const releasedAt = performance.now();
  const text = await dictation.finish();
  return { text, finishMs: Math.round(performance.now() - releasedAt), partials: updates.filter((update) => update.type === 'partial').length, finalsBeforeFinish };
}

async function batchMs(pcm: Uint8Array, model: string): Promise<number> {
  const startedAt = performance.now();
  for (let offset = 0; offset < pcm.byteLength; offset += 25 * PCM_BYTES_PER_SECOND) {
    await runTranscribeCli({ binary: CLI_BINARY, model, backend: localBackend(ARCH), threads: localThreads(), language: 'sk', pcm: pcm.subarray(offset, offset + 25 * PCM_BYTES_PER_SECOND) });
  }
  return Math.round(performance.now() - startedAt);
}

function report(label: string, value: unknown): void {
  process.stderr.write(`[real-latency] ${label}: ${JSON.stringify(value)}\n`);
}

describe.skipIf(!AVAILABLE)('LocalEngine with the real resident worker', () => {
  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'cw-real-engine-'));
    engine = await realEngine(MODEL ?? '');
  });

  afterEach(async () => {
    await engine.dispose();
    await rm(scratch, { recursive: true, force: true });
  });

  it('transcribes the Slovak sample with Parakeet', async () => {
    await expect(engine.isReady()).resolves.toEqual({ ready: true });
    const updates: TranscriptUpdate[] = [];
    const dictation = await start(false, updates);
    const pcm = await readWavPcm(SAMPLE);
    for (let offset = 0; offset < pcm.byteLength; offset += FRAME_BYTES) {
      dictation.push(pcm.subarray(offset, offset + FRAME_BYTES));
    }

    await expect(dictation.finish()).resolves.toBe(EXPECTED);
  }, 120_000);

  it.skipIf(!LONG_AVAILABLE)(
    'measures end of speech to final text for a long dictation in both overlay modes',
    async () => {
      const speech = (await readFile(LONG_SPEECH)).subarray(0, LONG_SECONDS * PCM_BYTES_PER_SECOND);
      await batchMs(new Uint8Array(PCM_BYTES_PER_SECOND), MODEL ?? '');
      const sample = await readWavPcm(SAMPLE);
      const indicator = await measure(false, speech);
      const live = await measure(true, speech);
      const shortIndicator = await measure(false, sample);
      const shortLive = await measure(true, sample);
      const batch = await batchMs(speech, MODEL ?? '');
      report('model', MODEL);
      report(`indicator ${LONG_SECONDS} s`, { ...indicator, text: indicator.text.length });
      report(`live ${LONG_SECONDS} s`, { ...live, text: live.text.length });
      report('indicator sample', { ...shortIndicator, text: shortIndicator.text.length });
      report('live sample', { ...shortLive, text: shortLive.text.length });
      report(`old batch path for ${LONG_SECONDS} s after key-up`, batch);

      expect(indicator.finalsBeforeFinish).toBeGreaterThanOrEqual(1);
      expect(indicator.partials).toBe(0);
      expect(live.partials).toBeGreaterThanOrEqual(LONG_SECONDS / 3);
      expect(indicator.text.split(' ').length).toBeGreaterThan(60);
      expect(live.text).toBe(indicator.text);
      expect(shortIndicator.text).toBe(EXPECTED);
    },
    300_000,
  );
});
