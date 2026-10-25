import { decodePcm16le, msToSamples } from '../../src/pcm/pcm-format';
import type { SegmentTranscriber } from '../../src/scheduling/segment-transcriber';
import type { TranscriptionJob } from '../../src/scheduling/transcription-job';

const KEY_SAMPLES = 8;
const LETTERS = 'bcdfghjklmnprstvzaeiou';

export type TimelineMode = {
  wordMs?: number;
  truncateAtCut?: boolean;
  fragmentAtStart?: boolean;
};

function wordFor(block: number): string {
  let state = (block + 1) * 2654435761;
  let word = '';
  for (let index = 0; index < 8; index += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    word += LETTERS[state % LETTERS.length] ?? 'a';
  }
  return word;
}

function inflect(word: string): string {
  return `${word.slice(0, -1)}.`;
}

export class TimelineTranscriber implements SegmentTranscriber {
  private readonly offsets = new Map<string, number>();
  private readonly ambiguous = new Set<string>();
  private readonly blockSamples: number;

  constructor(
    private readonly source: Int16Array,
    private readonly mode: TimelineMode = {},
  ) {
    this.blockSamples = msToSamples(mode.wordMs ?? 300);
    for (let offset = 0; offset + KEY_SAMPLES <= source.length; offset += 1) {
      const key = source.subarray(offset, offset + KEY_SAMPLES).join(',');
      if (this.offsets.has(key)) {
        this.ambiguous.add(key);
      }
      this.offsets.set(key, offset);
    }
  }

  transcribe(job: TranscriptionJob): Promise<string> {
    const samples = decodePcm16le(job.pcm);
    const key = samples.subarray(0, KEY_SAMPLES).join(',');
    const offset = this.offsets.get(key);
    if (offset === undefined || this.ambiguous.has(key)) {
      return Promise.reject(new Error('job audio does not map to one position in the timeline source'));
    }
    return Promise.resolve(this.render(offset, offset + samples.length).join(' '));
  }

  expectedText(endSample: number): string {
    return this.vocabulary(endSample).join(' ');
  }

  vocabulary(endSample: number): string[] {
    return this.blocksIn(0, endSample).map(wordFor);
  }

  private render(from: number, to: number): string[] {
    const words = this.blocksIn(from, to).map(wordFor);
    const first = words[0];
    if (from > 0 && first !== undefined) {
      words[0] = inflect(first);
    }
    return [...this.fragmentBefore(from), ...words, ...this.truncatedAfter(to)];
  }

  private fragmentBefore(from: number): string[] {
    const block = Math.floor(from / this.blockSamples);
    if (!this.mode.fragmentAtStart || from === 0 || this.center(block) >= from) {
      return [];
    }
    return [`${wordFor(block).slice(-4)}.`];
  }

  private truncatedAfter(to: number): string[] {
    const block = Math.floor(to / this.blockSamples);
    if (!this.mode.truncateAtCut || to >= this.source.length || this.center(block) < to || block * this.blockSamples >= to) {
      return [];
    }
    return [wordFor(block).slice(0, 5)];
  }

  private center(block: number): number {
    return (block + 0.5) * this.blockSamples;
  }

  private blocksIn(from: number, to: number): number[] {
    const blocks: number[] = [];
    for (let block = Math.max(0, Math.ceil(from / this.blockSamples - 0.5)); this.center(block) < to; block += 1) {
      blocks.push(block);
    }
    return blocks;
  }
}
