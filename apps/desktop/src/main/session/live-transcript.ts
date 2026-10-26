import type { TranscriptUpdate } from '../engines/transcription-engine';
import type { LiveText } from '../../shared/overlay-contract';

export const LIVE_TEXT_CHARS = 360;

type PartialUpdate = Extract<TranscriptUpdate, { type: 'partial' }>;

type Draft = { revision: number; words: string[]; stable: number };

type Word = { text: string; solid: boolean };

function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((word) => word.length > 0);
}

function sharedPrefix(previous: readonly string[], next: readonly string[]): number {
  let count = 0;
  while (count < previous.length && count < next.length && previous[count] === next[count]) {
    count += 1;
  }
  return count;
}

function clip(words: Word[]): Word[] {
  let length = words.reduce((total, word) => total + word.text.length + 1, -1);
  let start = 0;
  while (length > LIVE_TEXT_CHARS && start < words.length - 1) {
    length -= (words[start]?.text.length ?? 0) + 1;
    start += 1;
  }
  return words.slice(start);
}

export class LiveTranscript {
  private readonly finals = new Map<number, string[]>();
  private readonly drafts = new Map<number, Draft>();

  apply(update: TranscriptUpdate): void {
    if (update.type === 'restart') {
      this.finals.clear();
      this.drafts.clear();
      return;
    }
    if (update.type === 'final') {
      this.finals.set(update.segmentId, wordsOf(update.text));
      this.drafts.delete(update.segmentId);
      return;
    }
    this.draft(update);
  }

  view(): LiveText {
    const words = clip(this.words());
    const firstTentative = words.findIndex((word) => !word.solid);
    const split = firstTentative === -1 ? words.length : firstTentative;
    return {
      confirmed: words
        .slice(0, split)
        .map((word) => word.text)
        .join(' '),
      tentative: words
        .slice(split)
        .map((word) => word.text)
        .join(' '),
    };
  }

  private draft(update: PartialUpdate): void {
    if (this.finals.has(update.segmentId)) {
      return;
    }
    const previous = this.drafts.get(update.segmentId);
    if (previous !== undefined && update.revision <= previous.revision) {
      return;
    }
    const words = wordsOf(update.text);
    this.drafts.set(update.segmentId, { revision: update.revision, words, stable: previous === undefined ? 0 : sharedPrefix(previous.words, words) });
  }

  private words(): Word[] {
    const segments = [...new Set([...this.finals.keys(), ...this.drafts.keys()])].sort((left, right) => left - right);
    return segments.flatMap((segmentId) => this.segmentWords(segmentId));
  }

  private segmentWords(segmentId: number): Word[] {
    const final = this.finals.get(segmentId);
    if (final !== undefined) {
      return final.map((text) => ({ text, solid: true }));
    }
    const draft = this.drafts.get(segmentId);
    return (draft?.words ?? []).map((text, index) => ({ text, solid: index < (draft?.stable ?? 0) }));
  }
}
