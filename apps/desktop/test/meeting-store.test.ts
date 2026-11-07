import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MeetingStore } from '../src/main/meetings/meeting-store';
import { MEETING_ID } from '../src/shared/meetings';
import { RecordingLogger } from './recording-logger';

let dir: string;

beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'cw-meetings-')), 'meetings');
});

afterEach(async () => {
  await rm(join(dir, '..'), { recursive: true, force: true });
});

async function loaded(): Promise<MeetingStore> {
  const store = new MeetingStore(dir, new RecordingLogger());
  await store.load();
  return store;
}

it('creates a private meeting directory with a validated id and lists newest first', async () => {
  const store = await loaded();
  const older = await store.create({ startedAt: new Date(2026, 10, 7, 9, 5, 3).getTime(), systemAudio: 'recording', systemAudioNote: null });
  const newer = await store.create({ startedAt: new Date(2026, 10, 7, 10, 0, 0).getTime(), systemAudio: 'unsupported', systemAudioNote: 'Zvuk systému vyžaduje macOS 14.2 alebo novší.' });

  expect(older.id).toMatch(MEETING_ID);
  expect(older.id.startsWith('20261107-090503-')).toBe(true);
  expect(store.list().map((meeting) => meeting.id)).toEqual([newer.id, older.id]);
  expect(store.list()[0]).toMatchObject({ phase: { kind: 'recording' }, systemAudio: 'unsupported', durationMs: 0 });
  expect((await stat(dir)).mode & 0o777).toBe(0o700);
  expect((await stat(join(dir, older.id))).mode & 0o777).toBe(0o700);
  expect((await stat(join(dir, older.id, 'meeting.json'))).mode & 0o777).toBe(0o600);
  expect(store.trackPath(older.id, 'mic')).toBe(join(dir, older.id, 'mic.pcm'));
});

it('persists updates and turns across a reload', async () => {
  const store = await loaded();
  const meeting = await store.create({ startedAt: Date.now(), systemAudio: 'recording', systemAudioNote: null });
  await store.update(meeting.id, { durationMs: 61_000, tracks: { mic: { startOffsetMs: 12 }, system: null } });
  await store.finishTranscript(meeting.id, [{ speaker: 'Ja', t0Ms: 0, t1Ms: 500, text: 'Ahoj' }]);

  const reloaded = await loaded();

  expect(reloaded.get(meeting.id)).toMatchObject({ phase: { kind: 'ready' }, durationMs: 61_000, tracks: { mic: { startOffsetMs: 12 }, system: null } });
  await expect(reloaded.meeting(meeting.id)).resolves.toMatchObject({ id: meeting.id, turns: [{ speaker: 'Ja', text: 'Ahoj' }], notes: null, notesError: null });
});

it('recovers a meeting left recording as stopped with the duration of its longest track', async () => {
  const store = await loaded();
  const meeting = await store.create({ startedAt: Date.now(), systemAudio: 'recording', systemAudioNote: null });
  await store.update(meeting.id, { tracks: { mic: { startOffsetMs: 0 }, system: { startOffsetMs: 500 } } });
  await writeFile(store.trackPath(meeting.id, 'mic'), new Uint8Array(32_000 * 2));
  await writeFile(store.trackPath(meeting.id, 'system'), new Uint8Array(32_000 * 3));

  const recovered = await loaded();

  expect(recovered.get(meeting.id)).toMatchObject({ phase: { kind: 'stopped' }, durationMs: 3500 });
  expect(JSON.parse(await readFile(join(dir, meeting.id, 'meeting.json'), 'utf8'))).toMatchObject({ phase: { kind: 'stopped' } });
});

it('recovers an interrupted transcription as stopped', async () => {
  const store = await loaded();
  const meeting = await store.create({ startedAt: Date.now(), systemAudio: 'recording', systemAudioNote: null });
  await store.update(meeting.id, { phase: { kind: 'transcribing', step: 'system' } });

  expect((await loaded()).get(meeting.id)?.phase).toEqual({ kind: 'stopped' });
});

it('deletes the whole meeting directory', async () => {
  const store = await loaded();
  const meeting = await store.create({ startedAt: Date.now(), systemAudio: 'recording', systemAudioNote: null });
  await writeFile(store.trackPath(meeting.id, 'mic'), new Uint8Array(10));

  await store.delete(meeting.id);

  expect(store.list()).toEqual([]);
  expect(await readdir(dir)).toEqual([]);
});

it('skips directories that are not valid meetings', async () => {
  await mkdir(join(dir, '../meetings/not-a-meeting'), { recursive: true });
  await mkdir(join(dir, '20261107-090503-abcdef'), { recursive: true });
  await writeFile(join(dir, '20261107-090503-abcdef', 'meeting.json'), '{"broken":');

  expect((await loaded()).list()).toEqual([]);
});

it('notifies listeners with the list after every change', async () => {
  const store = await loaded();
  const seen: number[] = [];
  store.onChange((list) => seen.push(list.length));

  const meeting = await store.create({ startedAt: Date.now(), systemAudio: 'recording', systemAudioNote: null });
  await store.update(meeting.id, { phase: { kind: 'stopped' } });
  await store.delete(meeting.id);

  expect(seen).toEqual([1, 1, 0]);
});

it('keeps private notes and the last notes failure across a reload, but never a generation in progress', async () => {
  const store = await loaded();
  const meeting = await store.create({ startedAt: Date.now(), systemAudio: 'recording', systemAudioNote: null });
  await store.writeNotes(meeting.id, '## Zhrnutie\n\nDohodli sme termín.');
  await store.update(meeting.id, { notesPending: true, notesError: 'timeout' });

  const reloaded = await loaded();

  expect(reloaded.list()[0]).toMatchObject({ notesPending: false, notesError: 'timeout' });
  await expect(reloaded.meeting(meeting.id)).resolves.toMatchObject({ notes: '## Zhrnutie\n\nDohodli sme termín.', notesPending: false, notesError: 'timeout' });
  expect((await stat(join(dir, meeting.id, 'notes.md'))).mode & 0o777).toBe(0o600);
});

it('loads a meeting saved before notes existed', async () => {
  const id = '20261107-090503-abcdef';
  await mkdir(join(dir, id), { recursive: true });
  const record = { id, title: 'Stretnutie', startedAt: 1, durationMs: 2, phase: { kind: 'ready' }, systemAudio: 'recording', systemAudioNote: null, tracks: { mic: null, system: null } };
  await writeFile(join(dir, id, 'meeting.json'), JSON.stringify(record));

  expect((await loaded()).list()).toEqual([expect.objectContaining({ id, notesPending: false, notesError: null })]);
});

it('drops the notes and their failure when a new transcript replaces the old one', async () => {
  const store = await loaded();
  const meeting = await store.create({ startedAt: Date.now(), systemAudio: 'recording', systemAudioNote: null });
  await store.finishTranscript(meeting.id, [{ speaker: 'Ja', t0Ms: 0, t1Ms: 500, text: 'Vydanie bude v piatok.' }]);
  await store.writeNotes(meeting.id, '## Zhrnutie\n\nVydanie bude v piatok.');
  await store.update(meeting.id, { notesError: 'timeout' });

  await store.finishTranscript(meeting.id, [{ speaker: 'Ja', t0Ms: 0, t1Ms: 500, text: 'Vydanie bude v pondelok.' }]);

  for (const current of [store, await loaded()]) {
    await expect(current.meeting(meeting.id)).resolves.toMatchObject({ phase: { kind: 'ready' }, turns: [{ text: 'Vydanie bude v pondelok.' }], notes: null, notesError: null });
  }
});
