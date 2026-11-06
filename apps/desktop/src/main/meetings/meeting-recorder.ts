import { createWriteStream, type WriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import type { CaptureRequest, MeetingFrame } from '../../shared/capture-contract';
import type { MeetingSummary, MeetingTrack } from '../../shared/meetings';
import { parseMeetingStartResult } from '../audio/capture-payloads';
import type { Logger } from '../logging/logger';
import type { SystemAudioSource } from './linux-system-audio';
import type { MeetingStore, TrackInfo } from './meeting-store';

export type MeetingCaptureHost = {
  request(request: CaptureRequest): Promise<unknown>;
  onMeetingFrame(listener: (frame: MeetingFrame) => void): () => void;
};

export type SystemAudioPlan = { kind: 'source'; source: SystemAudioSource } | { kind: 'capture-window' } | { kind: 'unsupported'; note: string };

export type MeetingRecorderDeps = {
  store: MeetingStore;
  capture: MeetingCaptureHost;
  systemAudio: () => SystemAudioPlan;
  microphoneId: () => string | null;
  logger: Logger;
  clock?: () => number;
  systemSilenceMs?: number;
};

type TrackFile = { stream: WriteStream; firstAt: number | null };

type Recording = {
  id: string;
  startedAt: number;
  files: Partial<Record<MeetingTrack, TrackFile>>;
  plan: SystemAudioPlan;
  unsubscribe: () => void;
  silence: NodeJS.Timeout | null;
};

const SYSTEM_SILENCE_MS = 3000;
const CAPTURE_FAILED_NOTE = 'Zvuk systému sa nepodarilo zachytiť. Povoľte Codevo Whisper v Nastaveniach systému, časť Súkromie a bezpečnosť, Nahrávanie zvuku systému. Nahráva sa iba mikrofón.';
const SILENT_SOURCE_NOTE = 'Zvuk systému neprichádza. Nahráva sa iba mikrofón.';

function openTrack(path: string): TrackFile {
  return { stream: createWriteStream(path, { flags: 'a', mode: 0o600 }), firstAt: null };
}

export class MeetingRecorder {
  private recording: Recording | null = null;
  private transition: Promise<unknown> = Promise.resolve();
  private readonly clock: () => number;

  constructor(private readonly deps: MeetingRecorderDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  isBusy(): boolean {
    return this.recording !== null;
  }

  start(): Promise<MeetingSummary> {
    return this.serialize(() => this.begin());
  }

  stop(): Promise<string | null> {
    return this.serialize(() => this.end());
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.transition.then(work);
    this.transition = run.catch(() => undefined);
    return run;
  }

  private async begin(): Promise<MeetingSummary> {
    if (this.recording !== null) {
      throw new Error('Stretnutie sa už nahráva.');
    }
    const { store } = this.deps;
    const plan = this.deps.systemAudio();
    const startedAt = this.clock();
    const unsupported = plan.kind === 'unsupported';
    const record = await store.create({ startedAt, systemAudio: unsupported ? 'unsupported' : 'recording', systemAudioNote: unsupported ? plan.note : null });
    const files: Recording['files'] = { mic: openTrack(store.trackPath(record.id, 'mic')) };
    if (!unsupported) {
      files.system = openTrack(store.trackPath(record.id, 'system'));
    }
    const recording: Recording = { id: record.id, startedAt, files, plan, silence: null, unsubscribe: this.deps.capture.onMeetingFrame((frame) => this.receive(recording, frame)) };
    this.recording = recording;
    try {
      const result = parseMeetingStartResult(await this.deps.capture.request({ type: 'meeting-start', deviceId: this.deps.microphoneId(), system: plan.kind === 'capture-window' }));
      if (plan.kind === 'capture-window' && result.system === 'failed') {
        await this.failSystem(recording, CAPTURE_FAILED_NOTE);
      }
    } catch (error) {
      this.recording = null;
      await this.release(recording);
      await store.delete(record.id);
      throw error;
    }
    this.startSystem(recording);
    return store.get(record.id) ?? record;
  }

  private startSystem(recording: Recording): void {
    const system = recording.files.system;
    if (system === undefined) return;
    recording.silence = setTimeout(() => void this.failSystem(recording, recording.plan.kind === 'capture-window' ? CAPTURE_FAILED_NOTE : SILENT_SOURCE_NOTE), this.deps.systemSilenceMs ?? SYSTEM_SILENCE_MS);
    if (recording.plan.kind !== 'source') return;
    recording.plan.source.start(system.stream, {
      started: () => this.mark(recording, 'system'),
      failed: (note) => void this.failSystem(recording, note),
    });
  }

  private receive(recording: Recording, { track, pcm }: MeetingFrame): void {
    const file = recording.files[track];
    if (file === undefined || (track === 'system' && recording.plan.kind !== 'capture-window')) return;
    this.mark(recording, track);
    file.stream.write(pcm);
  }

  private mark(recording: Recording, track: MeetingTrack): void {
    const file = recording.files[track];
    if (file === undefined || file.firstAt !== null) return;
    file.firstAt = this.clock();
    if (track === 'system' && recording.silence !== null) {
      clearTimeout(recording.silence);
      recording.silence = null;
    }
    this.deps.store.update(recording.id, { tracks: this.tracks(recording) }).catch((error: unknown) => {
      this.deps.logger.error('The meeting track offset could not be saved', error);
    });
  }

  private async failSystem(recording: Recording, note: string): Promise<void> {
    if (this.recording !== recording || recording.files.system === undefined) return;
    const system = recording.files.system;
    if (recording.silence !== null) clearTimeout(recording.silence);
    recording.silence = null;
    if (system.firstAt === null) delete recording.files.system;
    if (recording.plan.kind === 'source') await recording.plan.source.stop();
    if (system.firstAt === null) await this.close(system);
    await this.deps.store.update(recording.id, { systemAudio: 'failed', systemAudioNote: note });
  }

  private async end(): Promise<string | null> {
    const recording = this.recording;
    if (recording === null) return null;
    this.recording = null;
    await this.deps.capture.request({ type: 'meeting-stop' }).catch((error: unknown) => {
      this.deps.logger.error('The meeting capture could not be stopped', error);
    });
    const stoppedAt = this.clock();
    await this.release(recording);
    await this.deps.store.update(recording.id, { phase: { kind: 'stopped' }, durationMs: stoppedAt - recording.startedAt, tracks: this.tracks(recording) });
    return recording.id;
  }

  private async release(recording: Recording): Promise<void> {
    if (recording.silence !== null) clearTimeout(recording.silence);
    recording.unsubscribe();
    if (recording.plan.kind === 'source') await recording.plan.source.stop();
    await Promise.all(Object.values(recording.files).map((file) => this.close(file)));
  }

  private async close(file: TrackFile): Promise<void> {
    file.stream.end();
    await finished(file.stream).catch((error: unknown) => {
      this.deps.logger.error('A meeting track file could not be written', error);
    });
  }

  private tracks(recording: Recording): Record<MeetingTrack, TrackInfo | null> {
    const offset = (file: TrackFile | undefined): TrackInfo | null => (file === undefined || file.firstAt === null ? null : { startOffsetMs: file.firstAt - recording.startedAt });
    return { mic: offset(recording.files.mic), system: offset(recording.files.system) };
  }
}
