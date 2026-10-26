import { TranscriptionDispatcher, type Clock } from '@codevo-whisper/audio';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalDictation, type LocalContext } from '../src/main/engines/local-dictation';
import { TranscribeCliTranscriber } from '../src/main/engines/transcribe-cli-transcriber';
import { TranscriptionFailedError, type TranscriptUpdate } from '../src/main/engines/transcription-engine';
import type { Language } from '../src/shared/settings';
import { readRecordedCalls } from '../../../packages/stt-runner/test/support/fake-cli';
import { expectedText, secondFrames, timelineSilence, timelineSpeech, writeTimeline } from './support/timeline-audio';

const FAKE_TIMELINE_CLI = fileURLToPath(new URL('./support/fake-timeline-cli.js', import.meta.url));
const MODEL = '/models/alpha.gguf';
const MAX_JOB_SAMPLES = 25 * 16_000;

class ManualClock implements Clock {
  private nowMs = 0;

  now(): number {
    return this.nowMs;
  }

  advance(ms: number): void {
    this.nowMs += ms;
  }
}

type Job = { offset: number; samples: number };

type Started = { dictation: LocalDictation; updates: TranscriptUpdate[]; controller: AbortController };

let scratch: string;
let clock: ManualClock;
let dispatcher: TranscriptionDispatcher<LocalContext>;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-local-dictation-'));
  vi.stubEnv('FAKE_TIMELINE_SOURCE', join(scratch, 'source.pcm'));
  vi.stubEnv('FAKE_TIMELINE_JOBS', join(scratch, 'jobs.txt'));
  vi.stubEnv('FAKE_CLI_ARGS_FILE', join(scratch, 'args.txt'));
  useDispatcher(60_000);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

function useDispatcher(timeoutMs: number): void {
  clock = new ManualClock();
  dispatcher = new TranscriptionDispatcher<LocalContext>({
    transcriber: new TranscribeCliTranscriber({ binary: FAKE_TIMELINE_CLI, backend: 'metal', threads: 2, timeoutMs }),
    clock,
  });
}

function start(partials: boolean, language: Language = 'sk'): Started {
  const updates: TranscriptUpdate[] = [];
  const controller = new AbortController();
  const dictation = new LocalDictation({
    dispatcher,
    clock,
    context: { language, model: MODEL },
    options: { language, signal: controller.signal, partials, onTranscript: (update) => updates.push(update) },
  });
  return { dictation, updates, controller };
}

async function speak(dictation: LocalDictation, samples: Int16Array): Promise<void> {
  for (const frame of secondFrames(samples)) {
    clock.advance(1000);
    dictation.push(frame);
    await dispatcher.whenIdle();
  }
}

async function jobs(): Promise<Job[]> {
  const text = await readFile(join(scratch, 'jobs.txt'), 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [offset, samples] = line.split(' ').map(Number);
      return { offset: offset ?? -1, samples: samples ?? -1 };
    });
}

function finals(updates: TranscriptUpdate[]): Array<Extract<TranscriptUpdate, { type: 'final' }>> {
  return updates.filter((update) => update.type === 'final');
}

function partials(updates: TranscriptUpdate[]): Array<Extract<TranscriptUpdate, { type: 'partial' }>> {
  return updates.filter((update) => update.type === 'partial');
}

function joinedFinals(updates: TranscriptUpdate[]): string {
  return finals(updates)
    .map((update) => update.text)
    .filter((text) => text !== '')
    .join(' ');
}

describe('LocalDictation', () => {
  it('transcribes a long Indikátor dictation progressively and only the open tail after the key is released', async () => {
    const samples = timelineSpeech(60);
    await writeTimeline(join(scratch, 'source.pcm'), samples);
    const { dictation, updates } = start(false);

    await speak(dictation, samples);
    const finalsBeforeFinish = finals(updates).length;
    const jobsBeforeFinish = (await jobs()).length;
    const text = await dictation.finish();

    expect(partials(updates)).toEqual([]);
    expect(finalsBeforeFinish).toBeGreaterThanOrEqual(2);
    const allJobs = await jobs();
    expect(allJobs.length - jobsBeforeFinish).toBe(1);
    expect(allJobs.every((job) => job.offset >= 0 && job.samples <= MAX_JOB_SAMPLES)).toBe(true);
    expect(text).toBe(expectedText(samples));
    expect(joinedFinals(updates)).toBe(text);
    expect(finals(updates).map((update) => update.segmentId)).toEqual(finals(updates).map((_update, index) => index));
  });

  it('streams partials with growing revisions in Živý text and finals in segment order', async () => {
    const samples = timelineSpeech(30);
    await writeTimeline(join(scratch, 'source.pcm'), samples);
    const { dictation, updates } = start(true);

    await speak(dictation, samples);
    const text = await dictation.finish();

    expect(partials(updates).length).toBeGreaterThanOrEqual(10);
    expect(text).toBe(expectedText(samples));
    expect(joinedFinals(updates)).toBe(text);
    const segments = new Set(partials(updates).map((update) => update.segmentId));
    for (const segmentId of segments) {
      const revisions = partials(updates)
        .filter((update) => update.segmentId === segmentId)
        .map((update) => update.revision);
      expect(revisions).toEqual([...revisions].sort((left, right) => left - right));
      expect(new Set(revisions).size).toBe(revisions.length);
      const finalIndex = updates.findIndex((update) => update.type === 'final' && update.segmentId === segmentId);
      const lastPartialIndex = updates.findLastIndex((update) => update.type === 'partial' && update.segmentId === segmentId);
      expect(finalIndex).toBeGreaterThan(lastPartialIndex);
    }
    expect(partials(updates).some((update) => update.text.length > 0)).toBe(true);
  });

  it('passes the language and the model of each session to transcribe-cli', async () => {
    const samples = timelineSpeech(4);
    await writeTimeline(join(scratch, 'source.pcm'), samples);
    const czech = start(false, 'cs');
    const english = start(false, 'en');

    await speak(czech.dictation, samples);
    await czech.dictation.finish();
    english.dictation.push(secondFrames(samples)[0] ?? new Uint8Array(0));
    await english.dictation.finish();

    const calls = await readRecordedCalls(join(scratch, 'args.txt'));
    expect(calls.map((call) => call[call.indexOf('--language') + 1])).toEqual(['cs', 'en']);
    expect(calls.every((call) => call[call.indexOf('--model') + 1] === MODEL)).toBe(true);
  });

  it('kills the running call on cancel and rejects with an AbortError', async () => {
    const samples = timelineSpeech(3);
    await writeTimeline(join(scratch, 'source.pcm'), samples);
    vi.stubEnv('FAKE_CLI_HANG_FROM_SAMPLE', '0');
    vi.stubEnv('FAKE_CLI_PID_FILE', join(scratch, 'pid.txt'));
    const { dictation, controller } = start(false);
    await speak(dictation, samples);

    const finished = dictation.finish();
    await expect.poll(() => readFile(join(scratch, 'pid.txt'), 'utf8').catch(() => '')).not.toBe('');
    const pid = Number(await readFile(join(scratch, 'pid.txt'), 'utf8'));
    const cancelledAt = Date.now();
    controller.abort();

    await expect(finished).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - cancelledAt).toBeLessThan(1000);
    await expect.poll(() => isRunning(pid)).toBe(false);
  });

  it('fails a dictation whose call exceeds the timeout and keeps the text recognised so far', async () => {
    useDispatcher(500);
    const samples = timelineSpeech(40);
    await writeTimeline(join(scratch, 'source.pcm'), samples);
    vi.stubEnv('FAKE_CLI_HANG_FROM_SAMPLE', String(120_000));
    const { dictation } = start(false);
    await speak(dictation, samples);

    const failure: unknown = await dictation.finish().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TranscriptionFailedError);
    const { reason, textSoFar } = failure as TranscriptionFailedError;
    expect(reason).toBe('engine-failed');
    expect(textSoFar.length).toBeGreaterThan(0);
    expect(expectedText(samples).startsWith(textSoFar)).toBe(true);
  });

  it('never calls transcribe-cli for a recording shorter than 20 ms', async () => {
    await writeTimeline(join(scratch, 'source.pcm'), timelineSpeech(1));
    const { dictation } = start(false);
    dictation.push(new Uint8Array(600));

    await expect(dictation.finish()).resolves.toBe('');
    await expect(jobs()).resolves.toEqual([]);
  });

  it('makes no call for a long silent dictation', async () => {
    const samples = timelineSilence(30);
    await writeTimeline(join(scratch, 'source.pcm'), samples);
    const { dictation, updates } = start(true);
    await speak(dictation, samples);

    await expect(dictation.finish()).resolves.toBe('');
    await expect(jobs()).resolves.toEqual([]);
    expect(partials(updates)).toEqual([]);
  });

  it('ignores audio after the key was released', async () => {
    const samples = timelineSpeech(2);
    await writeTimeline(join(scratch, 'source.pcm'), samples);
    const { dictation } = start(false);
    await speak(dictation, samples);

    const finished = dictation.finish();
    dictation.push(new Uint8Array(32_000));

    await expect(finished).resolves.toBe(expectedText(samples));
  });
});

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
