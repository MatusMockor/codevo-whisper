import type { TranscriptEvent } from '@codevo-whisper/audio';
import type { DictationLanguage } from '@codevo-whisper/protocol';
import type { SegmentKey, TranscriptObserver } from '../stt/gateway-context';
import type { SttTranscript } from '../stt/stt-client';

type PartialLanguage = { revision: number; language: DictationLanguage | null };

export class SegmentTranscripts implements TranscriptObserver {
  private readonly finals = new Map<number, DictationLanguage | null>();
  private readonly partials = new Map<number, PartialLanguage>();
  private readonly routeCounts = new Map<string, number>();

  observe(key: SegmentKey, transcript: SttTranscript): void {
    if (key.kind === 'partial') {
      this.observePartial(key, transcript.language);
      return;
    }
    this.finals.set(key.segmentId, transcript.language);
    this.count(transcript.route);
  }

  languageOf(event: TranscriptEvent): DictationLanguage | null {
    if (event.type === 'partial') {
      const partial = this.partials.get(event.segmentId);
      return partial?.revision === event.revision ? partial.language : null;
    }
    const language = this.finals.get(event.segmentId) ?? null;
    this.finals.delete(event.segmentId);
    this.partials.delete(event.segmentId);
    return language;
  }

  routes(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.routeCounts);
  }

  private observePartial(key: SegmentKey, language: DictationLanguage | null): void {
    const latest = this.partials.get(key.segmentId);
    if (latest !== undefined && latest.revision > key.revision) {
      return;
    }
    this.partials.set(key.segmentId, { revision: key.revision, language });
  }

  private count(route: string | null): void {
    if (route === null) {
      return;
    }
    this.routeCounts.set(route, (this.routeCounts.get(route) ?? 0) + 1);
  }
}
