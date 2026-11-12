import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MeetingStore, type MeetingRecord } from '../src/main/meetings/meeting-store';
import { MeetingTranscriber } from '../src/main/meetings/meeting-transcriber';
import type { ModelVerification } from '../src/main/engines/active-model';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';
import { RecordingLogger } from './recording-logger';
import type { LanguageHint } from '../src/shared/models';

const FAKE_CLI = fileURLToPath(new URL('../../../packages/stt-runner/test/support/fake-transcribe-cli.sh', import.meta.url));

let dir: string;
let cliDir: string;
let store: MeetingStore;
let verification: ModelVerification;
let languageHint: LanguageHint | null;
let settings: Settings;
let diarizer: string | null;
let logger: RecordingLogger;

function transcriber(): MeetingTranscriber {
  return new MeetingTranscriber({
    store,
    binary: FAKE_CLI,
    models: { activeModelPath: () => Promise.resolve('/models/parakeet.gguf'), verifyActive: () => Promise.resolve(verification), activeLanguageHint: () => languageHint },
    settings: { get: () => settings },
    backend: () => 'cpu',
    diarizer: () => Promise.resolve(diarizer),
    threads: 3,
    logger,
  });
}

async function stoppedMeeting(tracks: MeetingRecord['tracks'], audio: { mic?: number; system?: number }): Promise<string> {
  const meeting = await store.create({ startedAt: Date.now(), systemAudio: 'recording', systemAudioNote: null });
  await store.update(meeting.id, { phase: { kind: 'stopped' }, tracks });
  for (const track of ['mic', 'system'] as const) {
    const bytes = audio[track];
    if (bytes !== undefined) await writeFile(store.trackPath(meeting.id, track), new Uint8Array(bytes).fill(1));
  }
  return meeting.id;
}

async function cliPrints(track: 'mic' | 'system', words: string[], speakers: string[] = []): Promise<void> {
  await writeFile(
    join(cliDir, `${track}.txt`),
    `segments: 1\n  [   0.00 ->    9.00] ignored\nwords: ${words.length}\n${words.join('\n')}\nspeaker segments: ${speakers.length}\n${speakers.join('\n')}\n  realtime:   4x\n`,
  );
}

async function cliCalls(): Promise<string[][]> {
  return (await readFile(join(dir, 'args.txt'), 'utf8'))
    .split('--\n')
    .filter((call) => call !== '')
    .map((call) => call.trim().split('\n'));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-transcriber-'));
  cliDir = join(dir, 'cli');
  await mkdir(cliDir);
  store = new MeetingStore(join(dir, 'meetings'), new RecordingLogger());
  await store.load();
  verification = 'ok';
  languageHint = 'ignored';
  settings = { ...DEFAULT_SETTINGS, languages: { mode: 'selected', selected: ['sk'] } };
  diarizer = null;
  logger = new RecordingLogger();
  vi.stubEnv('FAKE_CLI_MODE', 'words-per-wav');
  vi.stubEnv('FAKE_CLI_STDOUT_DIR', cliDir);
  vi.stubEnv('FAKE_CLI_ARGS_FILE', join(dir, 'args.txt'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

it('transcribes each track with word timestamps and stores a speaker-attributed transcript', async () => {
  const id = await stoppedMeeting({ mic: { startOffsetMs: 0 }, system: { startOffsetMs: 1000 } }, { mic: 3201, system: 6400 });
  await cliPrints('mic', ['  [   0.00 ->    0.40] Ahoj', '  [   0.40 ->    0.80] všetci']);
  await cliPrints('system', ['  [   0.50 ->    0.90] fellow', '  [   0.90 ->    1.30] Americans']);
  const phases: string[] = [];
  store.onChange((list) => phases.push(JSON.stringify(list[0]?.phase)));

  await transcriber().transcribe(id);

  await expect(store.meeting(id)).resolves.toMatchObject({
    phase: { kind: 'ready' },
    turns: [
      { speaker: 'Ja', t0Ms: 0, t1Ms: 800, text: 'Ahoj všetci' },
      { speaker: 'Ostatní', t0Ms: 1500, t1Ms: 2300, text: 'fellow Americans' },
    ],
  });
  expect(phases).toEqual(['{"kind":"transcribing","step":"mic"}', '{"kind":"transcribing","step":"system"}', '{"kind":"ready"}']);
  const micWav = await readFile(join(cliDir, 'mic.seen.wav'));
  expect(micWav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(micWav.readUInt32LE(40)).toBe(3200);
  expect(micWav.byteLength).toBe(44 + 3200);
  const args = (await readFile(join(dir, 'args.txt'), 'utf8')).split('--\n')[0]?.trim().split('\n');
  expect(args?.slice(0, -1)).toEqual(['--model', '/models/parakeet.gguf', '--backend', 'cpu', '--threads', '3', '--timestamps', 'word', '--quiet']);
  expect(await readdir(join(dir, 'meetings', id))).not.toContain('mic.wav');
});

it('keeps the language of the meeting start for every track when settings change midway', async () => {
  languageHint = 'optional';
  settings = { ...DEFAULT_SETTINGS, languages: { mode: 'selected', selected: ['cs'] } };
  const id = await stoppedMeeting({ mic: { startOffsetMs: 0 }, system: { startOffsetMs: 0 } }, { mic: 3201, system: 3201 });
  await cliPrints('mic', ['  [   0.00 ->    0.40] Ahoj']);
  await cliPrints('system', ['  [   0.00 ->    0.40] Ahoj']);
  store.onChange((list) => {
    if (JSON.stringify(list[0]?.phase) !== '{"kind":"transcribing","step":"system"}') return;
    languageHint = 'ignored';
    settings = { ...DEFAULT_SETTINGS, languages: { mode: 'auto', selected: ['cs'] } };
  });

  await transcriber().transcribe(id);

  const calls = (await readFile(join(dir, 'args.txt'), 'utf8')).split('--\n').filter((call) => call.trim() !== '').map((call) => call.trim().split('\n'));
  expect(calls).toHaveLength(2);
  expect(calls.map((args) => args.slice(args.indexOf('--language'), args.indexOf('--language') + 2))).toEqual([['--language', 'cs'], ['--language', 'cs']]);
});

it.each([
  ['optional', { mode: 'selected', selected: ['cs'] }, ['--language', 'cs']],
  ['optional', { mode: 'selected', selected: ['cs', 'sk'] }, []],
  ['optional', { mode: 'auto', selected: ['cs'] }, []],
  ['ignored', { mode: 'selected', selected: ['cs'] }, []],
  ['required', { mode: 'selected', selected: ['cs'] }, []],
] as const)('passes a language hint only to a %s model with exactly one selected language: %j', async (hint, languages, expected) => {
  languageHint = hint;
  settings = { ...DEFAULT_SETTINGS, languages };
  const id = await stoppedMeeting({ mic: { startOffsetMs: 0 }, system: null }, { mic: 3201 });
  await cliPrints('mic', ['  [   0.00 ->    0.40] Ahoj']);

  await transcriber().transcribe(id);

  const args = (await readFile(join(dir, 'args.txt'), 'utf8')).split('--\n')[0]?.trim().split('\n') ?? [];
  const at = args.indexOf('--language');
  expect(at < 0 ? [] : args.slice(at, at + 2)).toEqual(expected);
});

it('labels remote speakers with the diarizer on the system track once it is downloaded', async () => {
  const id = await stoppedMeeting({ mic: { startOffsetMs: 0 }, system: { startOffsetMs: 1000 } }, { mic: 3201, system: 6400 });
  await cliPrints('mic', ['  [   0.00 ->    0.40] Ahoj']);
  await cliPrints('system', ['  [   0.50 ->    0.90] Dobrý', '  [   4.00 ->    4.40] Hello'], ['  [   0.32 ->    2.40] S1', '  [   3.90 ->    6.00] S2']);
  diarizer = '/models/sortformer.gguf';
  const phases: string[] = [];
  store.onChange((list) => phases.push(JSON.stringify(list[0]?.phase)));

  await transcriber().transcribe(id);

  await expect(store.meeting(id)).resolves.toMatchObject({
    phase: { kind: 'ready' },
    turns: [
      { speaker: 'Ja', t0Ms: 0, t1Ms: 400, text: 'Ahoj' },
      { speaker: 'Hovoriaci 1', t0Ms: 1500, t1Ms: 1900, text: 'Dobrý' },
      { speaker: 'Hovoriaci 2', t0Ms: 5000, t1Ms: 5400, text: 'Hello' },
    ],
  });
  expect(phases.slice(-3)).toEqual(['{"kind":"transcribing","step":"system"}', '{"kind":"transcribing","step":"speakers"}', '{"kind":"ready"}']);
  const calls = await cliCalls();
  expect(calls).toHaveLength(3);
  expect(calls[2]?.slice(0, -1)).toEqual(['--model', '/models/sortformer.gguf', '--backend', 'cpu', '--threads', '3', '--quiet']);
  expect(calls[2]?.at(-1)).toBe(join(dir, 'meetings', id, 'system.wav'));
  expect(await readdir(join(dir, 'meetings', id))).not.toContain('system.wav');
});

it('keeps the track labels and logs it when the diarizer fails', async () => {
  const id = await stoppedMeeting({ mic: null, system: { startOffsetMs: 0 } }, { system: 6400 });
  await cliPrints('system', ['  [   0.50 ->    0.90] Dobrý'], ['  [   0.32 ->    2.40] S1']);
  diarizer = '/models/sortformer.gguf';
  vi.stubEnv('FAKE_CLI_FAIL_MODEL', diarizer);

  await transcriber().transcribe(id);

  await expect(store.meeting(id)).resolves.toMatchObject({ phase: { kind: 'ready' }, turns: [{ speaker: 'Ostatní', text: 'Dobrý' }] });
  expect(logger.errors.map((entry) => entry.message)).toEqual([`Speakers of meeting ${id} could not be recognized`]);
});

it('does not run the diarizer when the system track has no words', async () => {
  const id = await stoppedMeeting({ mic: null, system: { startOffsetMs: 0 } }, { system: 6400 });
  await cliPrints('system', []);
  diarizer = '/models/sortformer.gguf';

  await transcriber().transcribe(id);

  expect(store.get(id)?.phase).toEqual({ kind: 'ready' });
  expect(await cliCalls()).toHaveLength(1);
});

it('skips a track that recorded nothing', async () => {
  const id = await stoppedMeeting({ mic: { startOffsetMs: 0 }, system: null }, { mic: 6400 });
  await cliPrints('mic', ['  [   0.00 ->    0.40] Ahoj']);

  await transcriber().transcribe(id);

  await expect(store.meeting(id)).resolves.toMatchObject({ phase: { kind: 'ready' }, turns: [{ speaker: 'Ja', text: 'Ahoj' }] });
  expect((await readFile(join(dir, 'args.txt'), 'utf8')).split('--\n').filter((call) => call !== '')).toHaveLength(1);
});

it('fails the meeting with a Slovak message when the CLI fails and can run again', async () => {
  const id = await stoppedMeeting({ mic: { startOffsetMs: 0 }, system: null }, { mic: 6400 });
  vi.stubEnv('FAKE_CLI_MODE', 'fail');
  const meetings = transcriber();

  await meetings.transcribe(id);

  expect(store.get(id)?.phase).toMatchObject({ kind: 'failed', error: expect.stringContaining('Prepis zlyhal') as unknown });
  vi.stubEnv('FAKE_CLI_MODE', 'words-per-wav');
  await cliPrints('mic', ['  [   0.00 ->    0.40] Znova']);
  await meetings.transcribe(id);
  await expect(store.meeting(id)).resolves.toMatchObject({ phase: { kind: 'ready' }, turns: [{ text: 'Znova' }] });
});

it('fails without a verified local model', async () => {
  const id = await stoppedMeeting({ mic: { startOffsetMs: 0 }, system: null }, { mic: 6400 });
  verification = 'missing';

  await transcriber().transcribe(id);

  expect(store.get(id)?.phase).toEqual({ kind: 'failed', error: 'Lokálny model nie je stiahnutý. Stiahnite ho na stránke Prepis a skúste prepis znova.' });
});

it('refuses a meeting that is still recording or unknown', async () => {
  const meeting = await store.create({ startedAt: Date.now(), systemAudio: 'recording', systemAudioNote: null });

  expect(() => transcriber().transcribe(meeting.id)).toThrow('Toto stretnutie sa teraz nedá prepísať.');
  expect(() => transcriber().transcribe('20261107-090503-abcdef')).toThrow('Toto stretnutie sa teraz nedá prepísať.');
});

it('runs one transcription at a time', async () => {
  const first = await stoppedMeeting({ mic: { startOffsetMs: 0 }, system: null }, { mic: 6400 });
  const second = await stoppedMeeting({ mic: { startOffsetMs: 0 }, system: null }, { mic: 6400 });
  await cliPrints('mic', ['  [   0.00 ->    0.40] Ahoj']);
  vi.stubEnv('FAKE_CLI_DELAY_S', '0.3');
  const meetings = transcriber();

  const both = Promise.all([meetings.transcribe(first), meetings.transcribe(second)]);
  await vi.waitFor(() => expect(store.get(first)?.phase.kind).toBe('transcribing'));
  expect(store.get(second)?.phase.kind).toBe('stopped');
  expect([meetings.isTranscribing(first), meetings.isTranscribing(second)]).toEqual([true, true]);
  await both;

  expect(store.get(second)?.phase.kind).toBe('ready');
  expect([meetings.isTranscribing(first), meetings.isTranscribing(second)]).toEqual([false, false]);
});
