import { runProcess, wavHeader, type TranscribeBackend } from '@codevo-whisper/stt-runner';
import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { MeetingTrack, SpeakerSegment } from '../../shared/meetings';
import { PCM_BYTES_PER_SAMPLE, PCM_BYTES_PER_SECOND } from '../../shared/pcm';
import type { Settings } from '../../shared/settings';
import type { ActiveModel } from '../engines/active-model';
import type { Logger } from '../logging/logger';
import { attributeSpeakers, type TrackWords } from './attribute-speakers';
import { parseCliWords } from './cli-words';
import { parseDiarization } from './diarization';
import type { MeetingRecord, MeetingStore } from './meeting-store';

export type MeetingTranscriberDeps = {
  store: MeetingStore;
  binary: string;
  models: Pick<ActiveModel, 'activeModelPath' | 'verifyActive'>;
  settings: { get(): Settings };
  backend: () => TranscribeBackend;
  diarizer: () => Promise<string | null>;
  logger: Logger;
  threads?: number;
};

const TRACKS: readonly MeetingTrack[] = ['mic', 'system'];
const MIN_TRACK_BYTES = PCM_BYTES_PER_SECOND / 10;
const STDOUT_LIMIT_BYTES = 32 * 1024 * 1024;
const MIN_TIMEOUT_MS = 10 * 60_000;
const MODEL_MISSING = 'Lokálny model nie je stiahnutý. Stiahnite ho v Nastaveniach a skúste prepis znova.';

function cliThreads(): number {
  return Math.max(2, Math.floor(availableParallelism() / 2));
}

async function writeWav(pcm: string, wav: string): Promise<number> {
  const size = (await stat(pcm).catch(() => null))?.size ?? 0;
  const dataBytes = size - (size % PCM_BYTES_PER_SAMPLE);
  if (dataBytes < MIN_TRACK_BYTES) return 0;
  const output = createWriteStream(wav, { mode: 0o600 });
  output.write(wavHeader(dataBytes));
  await pipeline(createReadStream(pcm, { end: dataBytes - 1 }), output);
  return dataBytes;
}

export class MeetingTranscriber {
  private tail: Promise<void> = Promise.resolve();
  private readonly queued = new Set<string>();
  private readonly controller = new AbortController();
  private running = 0;

  constructor(private readonly deps: MeetingTranscriberDeps) {}

  isBusy(): boolean {
    return this.running > 0;
  }

  abort(): Promise<void> {
    this.controller.abort();
    return this.tail;
  }

  transcribe(id: string): Promise<void> {
    const record = this.deps.store.get(id);
    if (record === null || record.phase.kind === 'recording' || record.phase.kind === 'transcribing') {
      throw new Error('Toto stretnutie sa teraz nedá prepísať.');
    }
    if (this.queued.has(id)) return this.tail;
    this.queued.add(id);
    this.running += 1;
    const run = this.tail.then(() => this.run(id));
    this.tail = run.finally(() => {
      this.queued.delete(id);
      this.running -= 1;
    });
    return this.tail;
  }

  private async run(id: string): Promise<void> {
    const { store } = this.deps;
    try {
      const record = store.get(id);
      if (record === null || this.controller.signal.aborted) return;
      const model = await this.deps.models.activeModelPath();
      if (model === null || (await this.deps.models.verifyActive()) !== 'ok') throw new Error(MODEL_MISSING);
      const tracks: TrackWords[] = [];
      for (const track of TRACKS) {
        const info = record.tracks[track];
        if (info === null) continue;
        await store.update(id, { phase: { kind: 'transcribing', step: track } });
        tracks.push({ track, startOffsetMs: info.startOffsetMs, ...(await this.track(record, track, model)) });
      }
      await store.writeTurns(id, attributeSpeakers(tracks));
      await store.update(id, { phase: { kind: 'ready' } });
    } catch (error) {
      if (this.controller.signal.aborted) return;
      this.deps.logger.error(`Meeting ${id} could not be transcribed`, error);
      const message = error instanceof Error ? error.message : String(error);
      await store.update(id, { phase: { kind: 'failed', error: message === MODEL_MISSING ? message : `Prepis zlyhal: ${message}` } }).catch((failure: unknown) => {
        this.deps.logger.error('The meeting failure could not be saved', failure);
      });
    }
  }

  private async track(record: MeetingRecord, track: MeetingTrack, model: string): Promise<Omit<TrackWords, 'track' | 'startOffsetMs'>> {
    const pcm = this.deps.store.trackPath(record.id, track);
    const wav = join(dirname(pcm), `${track}.wav`);
    try {
      const dataBytes = await writeWav(pcm, wav);
      if (dataBytes === 0) return { words: [] };
      const { language } = this.deps.settings.get();
      const timeoutMs = Math.max(MIN_TIMEOUT_MS, (dataBytes / PCM_BYTES_PER_SECOND) * 2000);
      const words = parseCliWords(
        await this.cli(['--model', model, '--backend', this.deps.backend(), ...(language === 'auto' ? [] : ['--language', language]), '--threads', this.threads(), '--timestamps', 'word', '--quiet', wav], timeoutMs),
      );
      if (track !== 'system' || words.length === 0) return { words };
      const segments = await this.speakers(record.id, wav, timeoutMs);
      return segments === null ? { words } : { words, segments };
    } finally {
      await rm(wav, { force: true });
    }
  }

  private async speakers(id: string, wav: string, timeoutMs: number): Promise<SpeakerSegment[] | null> {
    try {
      const diarizer = await this.deps.diarizer();
      if (diarizer === null) return null;
      await this.deps.store.update(id, { phase: { kind: 'transcribing', step: 'speakers' } });
      return parseDiarization(await this.cli(['--model', diarizer, '--backend', 'cpu', '--threads', this.threads(), '--quiet', wav], timeoutMs));
    } catch (error) {
      if (this.controller.signal.aborted) throw error;
      this.deps.logger.error(`Speakers of meeting ${id} could not be recognized`, error);
      return null;
    }
  }

  private cli(args: string[], timeoutMs: number): Promise<string> {
    return runProcess(this.deps.binary, args, { timeoutMs, signal: this.controller.signal, stdoutLimitBytes: STDOUT_LIMIT_BYTES });
  }

  private threads(): string {
    return String(this.deps.threads ?? cliThreads());
  }
}
