import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isMeetingId, type Meeting, type MeetingPhase, type MeetingSummary, type MeetingTrack, type SystemAudio, type Turn } from '../../shared/meetings';
import { PCM_BYTES_PER_SECOND } from '../../shared/pcm';
import { writeFileAtomic } from '../fs/atomic-write';
import { readOptionalFile } from '../fs/read-optional-file';
import { Listeners } from '../helper/listeners';
import { SerialQueue } from '../insertion/serial-queue';
import type { Logger } from '../logging/logger';
import { isPlainRecord } from '../settings/settings-fields';

export type TrackInfo = { startOffsetMs: number };

export type MeetingRecord = MeetingSummary & { tracks: Record<MeetingTrack, TrackInfo | null> };

export type MeetingPatch = Partial<Pick<MeetingRecord, 'phase' | 'durationMs' | 'systemAudio' | 'systemAudioNote' | 'tracks'>>;

export type NewMeeting = { startedAt: number; systemAudio: SystemAudio; systemAudioNote: string | null };

const RECORD_FILE = 'meeting.json';
const TURNS_FILE = 'transcript.json';
const TRACKS: readonly MeetingTrack[] = ['mic', 'system'];
const SYSTEM_AUDIO: readonly SystemAudio[] = ['recording', 'unsupported', 'failed'];
const TITLE_FORMAT = new Intl.DateTimeFormat('sk', { dateStyle: 'medium', timeStyle: 'short' });

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function meetingId(startedAt: number): string {
  const at = new Date(startedAt);
  const date = `${at.getFullYear()}${twoDigits(at.getMonth() + 1)}${twoDigits(at.getDate())}`;
  const time = `${twoDigits(at.getHours())}${twoDigits(at.getMinutes())}${twoDigits(at.getSeconds())}`;
  return `${date}-${time}-${randomBytes(3).toString('hex')}`;
}

function isPhase(value: unknown): value is MeetingPhase {
  if (!isPlainRecord(value)) return false;
  if (value['kind'] === 'transcribing') return value['step'] === 'mic' || value['step'] === 'system' || value['step'] === 'speakers';
  if (value['kind'] === 'failed') return typeof value['error'] === 'string';
  return value['kind'] === 'recording' || value['kind'] === 'stopped' || value['kind'] === 'ready';
}

function isSystemAudio(value: unknown): value is SystemAudio {
  return SYSTEM_AUDIO.some((known) => known === value);
}

function isTrackInfo(value: unknown): value is TrackInfo | null {
  return value === null || (isPlainRecord(value) && typeof value['startOffsetMs'] === 'number' && Number.isFinite(value['startOffsetMs']));
}

function parseRecord(text: string, id: string): MeetingRecord | null {
  const value: unknown = JSON.parse(text);
  if (!isPlainRecord(value) || value['id'] !== id || typeof value['title'] !== 'string' || !Number.isFinite(value['startedAt']) || !Number.isFinite(value['durationMs'])) return null;
  const { phase, systemAudio, systemAudioNote, tracks } = value;
  if (!isPhase(phase) || !isSystemAudio(systemAudio) || (systemAudioNote !== null && typeof systemAudioNote !== 'string')) return null;
  if (!isPlainRecord(tracks) || !isTrackInfo(tracks['mic']) || !isTrackInfo(tracks['system'])) return null;
  return {
    id,
    title: value['title'],
    startedAt: Number(value['startedAt']),
    durationMs: Number(value['durationMs']),
    phase,
    systemAudio,
    systemAudioNote,
    tracks: { mic: tracks['mic'], system: tracks['system'] },
  };
}

function summary({ id, title, startedAt, durationMs, phase, systemAudio, systemAudioNote }: MeetingRecord): MeetingSummary {
  return { id, title, startedAt, durationMs, phase, systemAudio, systemAudioNote };
}

export class MeetingStore {
  private readonly records = new Map<string, MeetingRecord>();
  private readonly queue = new SerialQueue();
  private readonly listeners: Listeners<MeetingSummary[]>;

  constructor(
    private readonly dir: string,
    private readonly logger: Logger,
  ) {
    this.listeners = new Listeners(logger, 'A meeting listener failed');
  }

  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    for (const id of (await readdir(this.dir)).filter(isMeetingId)) {
      const record = await this.read(id);
      if (record === null) continue;
      this.records.set(id, record);
      if (record.phase.kind === 'recording' || record.phase.kind === 'transcribing') {
        await this.update(id, { phase: { kind: 'stopped' }, durationMs: await this.recordedMs(record) });
      }
    }
  }

  list(): MeetingSummary[] {
    return [...this.records.values()].sort((a, b) => b.startedAt - a.startedAt).map(summary);
  }

  get(id: string): MeetingRecord | null {
    return this.records.get(id) ?? null;
  }

  async meeting(id: string): Promise<Meeting | null> {
    const record = this.get(id);
    if (record === null) return null;
    const turns = await readOptionalFile(join(this.dir, id, TURNS_FILE));
    return { ...summary(record), turns: turns === null ? [] : (JSON.parse(turns) as Turn[]), notes: null, notesError: null };
  }

  trackPath(id: string, track: MeetingTrack): string {
    return join(this.dir, id, `${track}.pcm`);
  }

  create(meeting: NewMeeting): Promise<MeetingRecord> {
    return this.queue.run(async () => {
      const id = meetingId(meeting.startedAt);
      await mkdir(join(this.dir, id), { recursive: true, mode: 0o700 });
      const record: MeetingRecord = { id, title: `Stretnutie ${TITLE_FORMAT.format(meeting.startedAt)}`, durationMs: 0, phase: { kind: 'recording' }, tracks: { mic: null, system: null }, ...meeting };
      await this.commit(record);
      return record;
    });
  }

  update(id: string, patch: MeetingPatch): Promise<MeetingRecord> {
    return this.queue.run(async () => {
      const current = this.records.get(id);
      if (current === undefined) throw new Error(`Unknown meeting ${id}`);
      const next = { ...current, ...patch };
      await this.commit(next);
      return next;
    });
  }

  writeTurns(id: string, turns: Turn[]): Promise<void> {
    return this.queue.run(() => writeFileAtomic(join(this.dir, id, TURNS_FILE), JSON.stringify(turns)));
  }

  delete(id: string): Promise<void> {
    return this.queue.run(async () => {
      await rm(join(this.dir, id), { recursive: true, force: true });
      this.records.delete(id);
      this.listeners.emit(this.list());
    });
  }

  onChange(listener: (meetings: MeetingSummary[]) => void): () => void {
    return this.listeners.add(listener);
  }

  private async read(id: string): Promise<MeetingRecord | null> {
    try {
      const text = await readOptionalFile(join(this.dir, id, RECORD_FILE));
      return text === null ? null : parseRecord(text, id);
    } catch (error) {
      this.logger.error(`Meeting ${id} could not be read`, error);
      return null;
    }
  }

  private async recordedMs(record: MeetingRecord): Promise<number> {
    let longest = 0;
    for (const track of TRACKS) {
      const info = record.tracks[track];
      const size = (await stat(this.trackPath(record.id, track)).catch(() => null))?.size ?? 0;
      if (info !== null) longest = Math.max(longest, info.startOffsetMs + Math.round((size / PCM_BYTES_PER_SECOND) * 1000));
    }
    return longest;
  }

  private async commit(record: MeetingRecord): Promise<void> {
    await writeFileAtomic(join(this.dir, record.id, RECORD_FILE), JSON.stringify(record));
    this.records.set(record.id, record);
    this.listeners.emit(this.list());
  }
}
