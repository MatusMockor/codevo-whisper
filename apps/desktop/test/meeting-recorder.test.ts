import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CaptureRequest, MeetingFrame } from '../src/shared/capture-contract';
import type { SystemAudioEvents, SystemAudioSource } from '../src/main/meetings/linux-system-audio';
import { MeetingRecorder, type SystemAudioPlan } from '../src/main/meetings/meeting-recorder';
import { MeetingStore } from '../src/main/meetings/meeting-store';
import { RecordingLogger } from './recording-logger';

class FakeMeetingCapture {
  readonly requests: CaptureRequest[] = [];
  startResult: unknown = { label: 'Mic', fallback: false, system: 'off' };
  startError: Error | null = null;
  stopReply: Promise<unknown> = Promise.resolve(null);
  private readonly listeners = new Set<(frame: MeetingFrame) => void>();

  request(request: CaptureRequest): Promise<unknown> {
    this.requests.push(request);
    if (request.type === 'meeting-start') {
      return this.startError === null ? Promise.resolve(this.startResult) : Promise.reject(this.startError);
    }
    return this.stopReply;
  }

  onMeetingFrame(listener: (frame: MeetingFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(frame: MeetingFrame): void {
    for (const listener of this.listeners) listener(frame);
  }
}

class FakeSystemSource implements SystemAudioSource {
  output: Writable | null = null;
  events: SystemAudioEvents | null = null;
  stops = 0;

  start(output: Writable, events: SystemAudioEvents): void {
    this.output = output;
    this.events = events;
  }

  play(bytes: number): void {
    this.events?.started();
    this.output?.write(new Uint8Array(bytes));
  }

  stop(): Promise<void> {
    this.stops += 1;
    return Promise.resolve();
  }
}

let dir: string;
let now: number;
let store: MeetingStore;
let capture: FakeMeetingCapture;
let source: FakeSystemSource;

function recorder(plan: () => SystemAudioPlan = () => ({ kind: 'source', source }), systemSilenceMs = 60_000): MeetingRecorder {
  return new MeetingRecorder({ store, capture, systemAudio: plan, microphoneId: () => Promise.resolve('mic-1'), logger: new RecordingLogger(), clock: () => now, systemSilenceMs });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-recorder-'));
  now = 1_000_000;
  store = new MeetingStore(join(dir, 'meetings'), new RecordingLogger());
  await store.load();
  capture = new FakeMeetingCapture();
  source = new FakeSystemSource();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it('records the mic frames and the system source to their own files on one clock', async () => {
  const meetings = recorder();
  const meeting = await meetings.start();
  now += 200;
  capture.send({ track: 'mic', pcm: new Uint8Array(3200) });
  capture.send({ track: 'mic', pcm: new Uint8Array(3200) });
  now += 300;
  source.play(6400);
  now += 700_000;

  await expect(meetings.stop()).resolves.toBe(meeting.id);

  expect(capture.requests).toEqual([{ type: 'meeting-start', deviceId: 'mic-1', system: false }, { type: 'meeting-stop' }]);
  expect((await readFile(store.trackPath(meeting.id, 'mic'))).byteLength).toBe(6400);
  expect((await readFile(store.trackPath(meeting.id, 'system'))).byteLength).toBe(6400);
  expect((await stat(store.trackPath(meeting.id, 'mic'))).mode & 0o777).toBe(0o600);
  expect(store.get(meeting.id)).toMatchObject({ phase: { kind: 'stopped' }, durationMs: 700_500, systemAudio: 'recording', tracks: { mic: { startOffsetMs: 200 }, system: { startOffsetMs: 500 } } });
  expect(source.stops).toBe(1);
  expect(meetings.isBusy()).toBe(false);
});

it('records only one meeting at a time', async () => {
  const meetings = recorder();
  await meetings.start();

  await expect(meetings.start()).rejects.toThrow('Stretnutie sa už nahráva.');
  expect(store.list()).toHaveLength(1);
});

it('keeps recording the mic when the system source fails', async () => {
  const meetings = recorder();
  const meeting = await meetings.start();

  source.events?.failed('chýba pw-record');
  capture.send({ track: 'mic', pcm: new Uint8Array(3200) });
  await vi.waitFor(() => expect(store.get(meeting.id)).toMatchObject({ systemAudio: 'failed', systemAudioNote: 'chýba pw-record' }));
  await meetings.stop();

  expect(store.get(meeting.id)).toMatchObject({ phase: { kind: 'stopped' }, tracks: { mic: { startOffsetMs: 0 }, system: null } });
  expect((await readFile(store.trackPath(meeting.id, 'mic'))).byteLength).toBe(3200);
});

it('marks the system track failed when no system audio arrives in time', async () => {
  const meetings = recorder(undefined, 20);
  const meeting = await meetings.start();

  await vi.waitFor(() => expect(store.get(meeting.id)).toMatchObject({ systemAudio: 'failed', systemAudioNote: 'Zvuk systému neprichádza. Nahráva sa iba mikrofón.' }));
  await meetings.stop();
});

it('takes system frames from the capture window on macOS and reports a denied capture', async () => {
  capture.startResult = { label: 'Mic', fallback: false, system: 'failed' };
  const meetings = recorder(() => ({ kind: 'capture-window' }));

  const meeting = await meetings.start();

  expect(capture.requests[0]).toEqual({ type: 'meeting-start', deviceId: 'mic-1', system: true });
  expect(store.get(meeting.id)).toMatchObject({ systemAudio: 'failed' });
  expect(store.get(meeting.id)?.systemAudioNote).toContain('Nahrávanie zvuku systému');
});

it('writes system frames from the capture window when the capture works', async () => {
  capture.startResult = { label: 'Mic', fallback: false, system: 'recording' };
  const meetings = recorder(() => ({ kind: 'capture-window' }));
  const meeting = await meetings.start();

  capture.send({ track: 'system', pcm: new Uint8Array(3200) });
  await meetings.stop();

  expect((await readFile(store.trackPath(meeting.id, 'system'))).byteLength).toBe(3200);
  expect(store.get(meeting.id)).toMatchObject({ systemAudio: 'recording', tracks: { system: { startOffsetMs: 0 } } });
});

it('records the mic only where system audio is unsupported', async () => {
  const meetings = recorder(() => ({ kind: 'unsupported', note: 'Zvuk systému vyžaduje macOS 14.2 alebo novší.' }));

  const meeting = await meetings.start();
  await meetings.stop();

  expect(store.get(meeting.id)).toMatchObject({ systemAudio: 'unsupported', systemAudioNote: 'Zvuk systému vyžaduje macOS 14.2 alebo novší.', tracks: { system: null } });
  await expect(stat(store.trackPath(meeting.id, 'system'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('removes the meeting and stops the capture when the microphone cannot be opened', async () => {
  capture.startError = new Error('NotAllowedError: Permission denied');
  const meetings = recorder();

  await expect(meetings.start()).rejects.toThrow('Permission denied');

  expect(store.list()).toEqual([]);
  expect(meetings.isBusy()).toBe(false);
  expect(source.stops).toBe(1);
  expect(capture.requests.at(-1)).toEqual({ type: 'meeting-stop' });
});

it('stays busy until a stop has settled', async () => {
  const meetings = recorder();
  await meetings.start();
  let release = (): void => undefined;
  capture.stopReply = new Promise((resolve) => {
    release = () => resolve(null);
  });

  const stopped = meetings.stop();
  await vi.waitFor(() => expect(capture.requests).toContainEqual({ type: 'meeting-stop' }));

  expect(meetings.isBusy()).toBe(true);
  release();
  await stopped;
  expect(meetings.isBusy()).toBe(false);
});

it('stops as a no-op when nothing records', async () => {
  await expect(recorder().stop()).resolves.toBeNull();
  expect(capture.requests).toEqual([]);
});

it('keeps running when a track file cannot be written', async () => {
  class UnwritableMicStore extends MeetingStore {
    override trackPath(id: string, track: 'mic' | 'system'): string {
      return track === 'mic' ? join(dir, 'missing', 'mic.pcm') : super.trackPath(id, track);
    }
  }
  store = new UnwritableMicStore(join(dir, 'meetings'), new RecordingLogger());
  await store.load();
  const logger = new RecordingLogger();
  const meetings = new MeetingRecorder({ store, capture, systemAudio: () => ({ kind: 'source', source }), microphoneId: () => Promise.resolve(null), logger, clock: () => now });
  const meeting = await meetings.start();

  capture.send({ track: 'mic', pcm: new Uint8Array(3200) });
  source.play(3200);
  await vi.waitFor(() => expect(logger.errors).not.toHaveLength(0));
  await meetings.stop();

  expect(logger.errors.map((entry) => entry.message)).toContain('A meeting track file could not be written');
  expect(store.get(meeting.id)?.phase).toEqual({ kind: 'stopped' });
  expect((await readFile(store.trackPath(meeting.id, 'system'))).byteLength).toBe(3200);
});
